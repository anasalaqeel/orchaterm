use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

// ── Windows process-tree kill via Job Object ──────────────────────────────────
// `child.kill()` (TerminateProcess) ends only the shell PID — grandchildren
// (e.g. a dev server the shell spawned) survive as orphans and keep their
// ports open. Assigning the child to a Job Object with KILL_ON_JOB_CLOSE
// makes Windows kill the *entire* tree the instant the job handle closes — on
// tab close, on app quit, and on crash. VS Code / Windows Terminal rely on the
// same mechanism.
#[cfg(target_os = "windows")]
mod winjob {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

    /// RAII handle to a kill-on-close Job Object. Dropping it closes the handle,
    /// which tells Windows to terminate every process assigned to the job.
    pub(crate) struct JobHandle(HANDLE);

    // HANDLE wraps a raw pointer (not auto Send/Sync), but it is an opaque
    // kernel handle — safe to move/share across threads. Access is serialized
    // by the surrounding session Mutex; only Drop closes it.
    unsafe impl Send for JobHandle {}
    unsafe impl Sync for JobHandle {}

    impl Drop for JobHandle {
        fn drop(&mut self) {
            if !self.0.is_invalid() {
                unsafe {
                    let _ = CloseHandle(self.0);
                }
            }
        }
    }

    /// Create a kill-on-close job and assign `pid` to it. Returns `None` on any
    /// Win32 failure — the caller proceeds without tree-kill (the direct child
    /// is still terminated by `kill_pty`). The job handle is wrapped in
    /// `JobHandle` immediately so every return path (including `?`) closes it.
    pub(crate) fn create_kill_tree_job(pid: u32) -> Option<JobHandle> {
        unsafe {
            let job = JobHandle(CreateJobObjectW(None, PCWSTR::null()).ok()?);

            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
            .ok()?;

            // PROCESS_SET_QUOTA is required to assign a process to a job;
            // PROCESS_TERMINATE lets the job kill it. On Windows 8+ a process
            // may already belong to another job — nested jobs make this succeed.
            let proc = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid).ok()?;
            let assigned = AssignProcessToJobObject(job.0, proc).is_ok();
            let _ = CloseHandle(proc); // child stays in the job after this closes
            if assigned {
                Some(job)
            } else {
                None // job drops here → handle closed, no leak
            }
        }
    }
}

// ── Shell detection ────────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
struct ShellInfo {
    /// Human-readable label shown in the dropdown.
    name: String,
    /// The executable passed to spawn_pty (bare name or absolute path).
    path: String,
    /// Optional extra arguments passed after the executable (e.g. ["--", "bash"]
    /// for `wsl -- bash`).
    args: Vec<String>,
}

/// Resolves `exe` (a bare name like "bash") to its full path by walking PATH.
/// Returns `None` if not found.
fn resolve_in_path(exe: &str) -> Option<std::path::PathBuf> {
    let path_env = std::env::var("PATH").unwrap_or_default();
    for dir in std::env::split_paths(&path_env) {
        let candidate = dir.join(exe);
        if candidate.exists() {
            return Some(candidate);
        }
        #[cfg(target_os = "windows")]
        for ext in &["exe", "cmd", "bat"] {
            let with_ext = dir.join(format!("{exe}.{ext}"));
            if with_ext.exists() {
                return Some(with_ext);
            }
        }
    }
    None
}

/// Canonicalizes a path for deduplication — falls back to the original path
/// string if canonicalization fails (e.g. the file doesn't exist yet).
fn canonical_key(p: &Path) -> String {
    std::fs::canonicalize(p)
        .unwrap_or_else(|_| p.to_path_buf())
        .to_string_lossy()
        .to_lowercase()
}

#[tauri::command]
fn get_available_shells() -> Vec<ShellInfo> {
    let simple = |name: &str, path: &str| ShellInfo {
        name: name.to_string(),
        path: path.to_string(),
        args: vec![],
    };

    let mut shells: Vec<ShellInfo> = Vec::new();
    let mut seen_keys: std::collections::HashSet<String> = std::collections::HashSet::new();

    // ── macOS / Linux ────────────────────────────────────────────────────
    #[cfg(not(target_os = "windows"))]
    {
        // Shells with well-known absolute paths (checked first so the stored
        // path is always the canonical absolute one, not a bare name).
        let abs: &[(&str, &str)] = &[
            ("zsh", "/bin/zsh"),
            ("bash", "/bin/bash"),
            ("sh", "/bin/sh"),
            ("dash", "/bin/dash"),
        ];
        for (label, abs_path) in abs {
            let p = Path::new(abs_path);
            if !p.exists() {
                continue;
            }
            let key = canonical_key(p);
            if seen_keys.contains(&key) {
                continue;
            }
            seen_keys.insert(key);
            shells.push(simple(label, abs_path));
        }

        // Shells that live in user-managed locations (Homebrew, etc.) and are
        // only reachable via PATH.
        let by_name: &[(&str, &str)] = &[("fish", "fish"), ("nu", "nu"), ("elvish", "elvish")];
        for (label, exe) in by_name {
            if let Some(full_path) = resolve_in_path(exe) {
                let key = canonical_key(&full_path);
                if seen_keys.contains(&key) {
                    continue;
                }
                seen_keys.insert(key);
                shells.push(simple(label, full_path.to_string_lossy().as_ref()));
            }
        }

        // Guarantee a fallback — /bin/sh exists on every POSIX system.
        if shells.is_empty() {
            shells.push(simple("sh", "/bin/sh"));
        }
    }

    // ── Windows ──────────────────────────────────────────────────────────
    #[cfg(target_os = "windows")]
    {
        let mut wsl_found = false;

        // Shells looked up by name in PATH.
        // Do NOT include bash/zsh/fish here — on Windows bash is either
        // Git Bash (absolute path below) or WSL bash (synthetic entry).
        let named: &[(&str, &str)] = &[
            ("PowerShell 7", "pwsh"),
            ("PowerShell", "powershell"),
            ("Command Prompt", "cmd"),
            ("WSL", "wsl"),
        ];
        for (label, exe) in named {
            if let Some(full_path) = resolve_in_path(exe) {
                let key = canonical_key(&full_path);
                if seen_keys.contains(&key) {
                    continue;
                }
                seen_keys.insert(key);
                if *exe == "wsl" {
                    wsl_found = true;
                }
                shells.push(simple(label, exe));
            }
        }

        // Synthetic: bash inside WSL.
        if wsl_found {
            shells.push(ShellInfo {
                name: "WSL bash".to_string(),
                path: "wsl".to_string(),
                args: vec!["--".to_string(), "bash".to_string()],
            });
        }

        // Git Bash / PowerShell 7 via known absolute paths.
        let abs: &[(&str, &str)] = &[
            ("Git Bash", r"C:\Program Files\Git\bin\bash.exe"),
            ("Git Bash", r"C:\Program Files (x86)\Git\bin\bash.exe"),
            ("PowerShell 7", r"C:\Program Files\PowerShell\7\pwsh.exe"),
        ];
        for (label, abs_path) in abs {
            let p = Path::new(abs_path);
            if !p.exists() {
                continue;
            }
            let key = canonical_key(p);
            if seen_keys.contains(&key) {
                continue;
            }
            seen_keys.insert(key);
            shells.push(simple(label, abs_path));
        }

        // Guarantee a fallback.
        if shells.is_empty() {
            shells.push(simple("Command Prompt", "cmd"));
        }
    }

    shells
}

// ── Per-session state ──────────────────────────────────────────────────────────
// Writer is stored behind its own Arc<Mutex> so that `write_pty` only locks the
// writer — never blocking resize / kill / spawn operations on other sessions.

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    /// Behind its own Arc<Mutex> (like the writer) so the monitor thread can
    /// poll `try_wait` and `kill_pty` can reap WITHOUT locking the global
    /// session map — one stuck child can no longer freeze every other PTY.
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    /// Flipped to `true` by `kill_pty` so the reader thread exits promptly.
    shutdown: Arc<AtomicBool>,
    /// Windows only: kill-on-close job that takes the whole process tree with
    /// the session when it drops (tab close / app quit / crash).
    #[cfg(target_os = "windows")]
    #[allow(dead_code)] // never read — held purely for its Drop side-effect
    job: Option<winjob::JobHandle>,
}

type PtyState = Mutex<HashMap<String, PtySession>>;

#[derive(Clone, Serialize)]
struct PtyPayload {
    session_id: String,
    data: String,
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/// Clamp terminal dimensions so ConPTY never receives 0-width / 0-height.
fn clamp_dims(cols: u16, rows: u16) -> (u16, u16) {
    (cols.max(1), rows.max(1))
}

/// Converts as much of `buf` to valid UTF-8 as possible and returns it,
/// leaving any trailing incomplete multi-byte sequence in `buf` for the next
/// call.
///
/// PTY output is a raw byte stream with no message framing, so a multi-byte
/// UTF-8 character (box-drawing glyphs, emoji, spinner characters — exactly
/// what TUI/AI-agent output uses) can land split across two separate
/// `read()` calls. Converting each read independently with
/// `String::from_utf8_lossy` corrupts both halves into U+FFFD. Buffering the
/// incomplete tail across reads avoids that; genuinely invalid byte
/// sequences (not just truncated ones) are still replaced with U+FFFD,
/// matching `from_utf8_lossy`'s behavior everywhere else.
fn drain_valid_utf8(buf: &mut Vec<u8>) -> String {
    let mut out = String::new();
    loop {
        match std::str::from_utf8(buf) {
            Ok(s) => {
                out.push_str(s);
                buf.clear();
                return out;
            }
            Err(e) => {
                let valid_up_to = e.valid_up_to();
                out.push_str(std::str::from_utf8(&buf[..valid_up_to]).unwrap());
                match e.error_len() {
                    // The buffer ends mid-sequence — it may complete on the next
                    // read. Keep only the incomplete tail and stop.
                    None => {
                        buf.drain(..valid_up_to);
                        // A UTF-8 sequence is at most 4 bytes. A tail that's
                        // still "incomplete" at that length isn't going to
                        // complete (this only happens on raw binary output,
                        // not real text) — flush it lossily instead of
                        // holding it forever.
                        if buf.len() >= 4 {
                            out.push_str(&String::from_utf8_lossy(buf));
                            buf.clear();
                        }
                        return out;
                    }
                    // Genuinely invalid bytes (not a truncation) — replace and
                    // keep scanning the remainder of the buffer.
                    Some(bad_len) => {
                        out.push('\u{FFFD}');
                        buf.drain(..valid_up_to + bad_len);
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod drain_valid_utf8_tests {
    use super::drain_valid_utf8;

    #[test]
    fn passes_through_plain_ascii() {
        let mut buf = b"hello world".to_vec();
        assert_eq!(drain_valid_utf8(&mut buf), "hello world");
        assert!(buf.is_empty());
    }

    #[test]
    fn passes_through_complete_multibyte_chars() {
        let mut buf = "héllo 世界 🎉".as_bytes().to_vec();
        assert_eq!(drain_valid_utf8(&mut buf), "héllo 世界 🎉");
        assert!(buf.is_empty());
    }

    #[test]
    fn holds_back_a_sequence_split_across_two_reads() {
        // "🎉" (U+1F389) is 4 bytes in UTF-8: F0 9F 8E 89.
        let full = "🎉".as_bytes().to_vec();
        assert_eq!(full.len(), 4);

        // First "read" delivers only the first 2 bytes of the character.
        let mut buf = full[..2].to_vec();
        assert_eq!(drain_valid_utf8(&mut buf), "");
        assert_eq!(buf, full[..2]); // held back, not corrupted into U+FFFD

        // Second "read" delivers the rest — buf now completes the character.
        buf.extend_from_slice(&full[2..]);
        assert_eq!(drain_valid_utf8(&mut buf), "🎉");
        assert!(buf.is_empty());
    }

    #[test]
    fn split_char_with_valid_text_before_and_after() {
        let emoji = "🎉".as_bytes().to_vec();
        let mut first_chunk = b"before ".to_vec();
        first_chunk.extend_from_slice(&emoji[..3]); // 3 of 4 bytes

        let out1 = drain_valid_utf8(&mut first_chunk);
        assert_eq!(out1, "before ");
        assert_eq!(first_chunk, emoji[..3]);

        let mut second_chunk = first_chunk;
        second_chunk.push(emoji[3]);
        second_chunk.extend_from_slice(b" after");
        let out2 = drain_valid_utf8(&mut second_chunk);
        assert_eq!(out2, "🎉 after");
        assert!(second_chunk.is_empty());
    }

    #[test]
    fn genuinely_invalid_byte_becomes_replacement_char_and_scanning_continues() {
        let mut buf = vec![b'a', 0xFF, b'b'];
        assert_eq!(drain_valid_utf8(&mut buf), "a\u{FFFD}b");
        assert!(buf.is_empty());
    }

    #[test]
    fn does_not_hold_a_tail_forever_on_raw_binary_garbage() {
        // 4+ trailing high bytes that never form valid UTF-8 must eventually
        // flush (lossily) rather than growing the carry buffer forever.
        let mut buf = vec![0xF0, 0x9F, 0x8E, 0xFF, 0xFF];
        let out = drain_valid_utf8(&mut buf);
        assert!(!out.is_empty());
        assert!(buf.is_empty());
    }

    #[test]
    fn empty_input_returns_empty_string() {
        let mut buf: Vec<u8> = Vec::new();
        assert_eq!(drain_valid_utf8(&mut buf), "");
        assert!(buf.is_empty());
    }
}

/// Recover data from a potentially poisoned mutex.
fn lock_sessions(
    state: &PtyState,
) -> Result<std::sync::MutexGuard<'_, HashMap<String, PtySession>>, String> {
    match state.lock() {
        Ok(guard) => Ok(guard),
        // If a previous holder panicked the data is still usable — recover it.
        Err(poisoned) => Ok(poisoned.into_inner()),
    }
}

// ── Platform shell helpers ─────────────────────────────────────────────────────

/// Returns the best available shell for the current platform.
/// Mirrors the priority order used by `get_available_shells` so the two
/// functions always agree on what the "default" shell is.
fn platform_default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        // Prefer pwsh (PowerShell 7) if installed, else fall back to powershell.
        for exe in &["pwsh", "powershell"] {
            if resolve_in_path(exe).is_some() {
                return exe.to_string();
            }
        }
        "powershell".to_string()
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Walk the same absolute-path list as get_available_shells.
        for path in &["/bin/zsh", "/bin/bash", "/bin/sh"] {
            if std::path::Path::new(path).exists() {
                return path.to_string();
            }
        }
        "/bin/sh".to_string() // POSIX guarantee
    }
}

/// Returns the platform's last-resort fallback shell (used when the primary
/// shell fails to spawn).
fn platform_fallback_shell() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "cmd"
    }
    #[cfg(not(target_os = "windows"))]
    {
        "/bin/sh"
    }
}

// ── Tauri Commands ─────────────────────────────────────────────────────────────

#[tauri::command(async)]
fn spawn_pty(
    session_id: String,
    workspace_path: String,
    cols: u16,
    rows: u16,
    shell: Option<String>,
    // Extra args passed after the exe, e.g. ["--", "bash"] for `wsl -- bash`.
    shell_args: Option<Vec<String>>,
    state: State<'_, PtyState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let (cols, rows) = clamp_dims(cols, rows);

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {e}"))?;

    // Build shell command — use caller's preference or the first available
    // platform shell (same priority order as get_available_shells).
    let shell_to_use = shell
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| platform_default_shell());

    let mut cmd = CommandBuilder::new(&shell_to_use);

    // Make shell a login shell on macOS/Linux so it sources .zprofile/.bash_profile
    // This ensures PATH and aliases like 'code' are available.
    // -l flag works for bash, zsh, and most POSIX shells.
    // Skip for shells that don't support it (like nu, elvish) or on Windows.
    #[cfg(not(target_os = "windows"))]
    {
        let shell_name = shell_to_use
            .rsplit('/')
            .next()
            .unwrap_or(&shell_to_use);
        if matches!(shell_name, "zsh" | "bash" | "sh" | "dash") {
            cmd.arg("-l");
        }
    }

    // Append any extra args (e.g. ["--", "bash"] for wsl).
    if let Some(args) = shell_args {
        for arg in args {
            cmd.arg(arg);
        }
    }
    if !workspace_path.trim().is_empty() {
        cmd.cwd(&workspace_path);
    }
    cmd.env("TERM", "xterm-256color");

    let child = pair
        .slave
        .spawn_command(cmd)
        .or_else(|_| {
            let mut fallback = CommandBuilder::new(platform_fallback_shell());
            // Add login flag for fallback shell too (POSIX only)
            #[cfg(not(target_os = "windows"))]
            fallback.arg("-l");
            if !workspace_path.trim().is_empty() {
                fallback.cwd(&workspace_path);
            }
            fallback.env("TERM", "xterm-256color");
            pair.slave.spawn_command(fallback)
        })
        .map_err(|e| format!("Failed to spawn shell: {e}"))?;

    // Drop the slave handle immediately — on Windows ConPTY this prevents
    // the reader from blocking indefinitely.
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone reader: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take writer: {e}"))?;

    let shutdown = Arc::new(AtomicBool::new(false));

    // Windows: assign the child to a kill-on-close job BEFORE it can spawn
    // grandchildren, so the whole tree dies with this session.
    #[cfg(target_os = "windows")]
    let job = child.process_id().and_then(winjob::create_kill_tree_job);

    // Child handle behind its own Arc<Mutex> so the monitor thread polls it
    // without ever touching the global session map.
    let child = Arc::new(Mutex::new(child));

    let session = PtySession {
        master: pair.master,
        writer: Arc::new(Mutex::new(writer)),
        child: Arc::clone(&child),
        shutdown: Arc::clone(&shutdown),
        #[cfg(target_os = "windows")]
        job,
    };

    {
        let mut sessions = lock_sessions(&state)?;
        // If a stale session exists for this ID, kill it first.
        if let Some(old) = sessions.remove(&session_id) {
            old.shutdown.store(true, Ordering::SeqCst);
            if let Ok(mut c) = old.child.lock() {
                let _ = c.kill();
            }
        }
        sessions.insert(session_id.clone(), session);
    }

    // ── Child process monitor thread ───────────────────────────────────────
    // portable_pty's reader thread can block indefinitely on Windows even after
    // the child process dies. Polling `try_wait` guarantees we detect the exit.
    // Polls only this session's child Arc — never the global session map — so it
    // cannot contend with write_pty / resize_pty / spawn_pty.
    let sid_monitor = session_id.clone();
    let app_handle_monitor = app_handle.clone();
    let child_monitor = Arc::clone(&child);
    let shutdown_monitor = Arc::clone(&shutdown);

    thread::spawn(move || {
        loop {
            thread::sleep(std::time::Duration::from_millis(100));
            // kill_pty flips this and removes the session — stop promptly.
            if shutdown_monitor.load(Ordering::SeqCst) {
                break;
            }
            let exited = {
                let mut child = match child_monitor.lock() {
                    Ok(c) => c,
                    Err(p) => p.into_inner(),
                };
                match child.try_wait() {
                    Ok(Some(_status)) => true,
                    Ok(None) => false,
                    Err(_) => true, // error checking status — assume dead
                }
            };
            if exited {
                let payload = PtyPayload {
                    session_id: sid_monitor.clone(),
                    data: String::new(),
                };
                let _ = app_handle_monitor
                    .emit(&format!("pty-exit-{}", sid_monitor), payload);

                // Remove the session so its master/writer drop and the reader
                // thread unblocks — otherwise a naturally-exited shell leaks a
                // PTY handle + blocked reader thread until the tab is closed.
                if let Ok(mut sessions) =
                    lock_sessions(&app_handle_monitor.state::<PtyState>())
                {
                    sessions.remove(&sid_monitor);
                }
                break;
            }
        }
    });

    // ── Reader thread ──────────────────────────────────────────────────────
    // Reads output from the PTY master and emits a session-scoped Tauri event.
    // The event name is `pty-data-{session_id}` so each TerminalTab only
    // listens to its own stream — no O(N) filtering on the frontend.
    let sid = session_id.clone();
    let event_name = format!("pty-data-{sid}");

    thread::Builder::new()
        .name(format!("pty-reader-{sid}"))
        .spawn(move || {
            let mut buffer = [0u8; 8192];
            // Holds any UTF-8 sequence left incomplete at the end of a read —
            // see drain_valid_utf8 for why (a multi-byte char can straddle
            // two separate read() calls; this stops that from corrupting into
            // U+FFFD on both sides).
            let mut carry: Vec<u8> = Vec::new();
            loop {
                // Check shutdown flag before each read.
                if shutdown.load(Ordering::SeqCst) {
                    break;
                }

                match reader.read(&mut buffer) {
                    Ok(0) => break, // EOF
                    Ok(n) => {
                        carry.extend_from_slice(&buffer[..n]);
                        let text = drain_valid_utf8(&mut carry);
                        if text.is_empty() {
                            // Nothing decodable yet — still waiting on the rest
                            // of a split character. Don't emit an empty event.
                            continue;
                        }
                        let payload = PtyPayload {
                            session_id: sid.clone(),
                            data: text,
                        };
                        if app_handle.emit(&event_name, payload).is_err() {
                            // App window closed — stop the thread.
                            break;
                        }
                    }
                    Err(e) => {
                        // On Windows, ERROR_BROKEN_PIPE (code 109) is normal when
                        // the shell exits.  Other errors are unexpected.
                        let code = e.raw_os_error().unwrap_or(0);
                        if code != 109 {
                            eprintln!("[pty-reader-{sid}] read error: {e}");
                        }
                        break;
                    }
                }
            }
        })
        .map_err(|e| format!("Failed to spawn reader thread: {e}"))?;

    Ok(())
}

#[tauri::command(async)]
fn write_pty(session_id: String, data: String, state: State<'_, PtyState>) -> Result<(), String> {
    // Grab a clone of the Arc<Mutex<Writer>> so we can drop the sessions lock
    // before performing the (potentially blocking) write.
    let writer_arc = {
        let sessions = lock_sessions(&state)?;
        sessions
            .get(&session_id)
            .map(|s| Arc::clone(&s.writer))
            .ok_or_else(|| format!("Session not found: {session_id}"))?
    };

    let mut writer = writer_arc.lock().map_err(|_| "Writer lock poisoned")?;
    writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Write failed: {e}"))?;
    writer.flush().map_err(|e| format!("Flush failed: {e}"))?;

    Ok(())
}

#[tauri::command(async)]
fn resize_pty(
    session_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, PtyState>,
) -> Result<(), String> {
    let (cols, rows) = clamp_dims(cols, rows);

    let sessions = lock_sessions(&state)?;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| format!("Session not found: {session_id}"))?;

    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Resize failed: {e}"))?;

    Ok(())
}

#[tauri::command(async)]
fn kill_pty(session_id: String, state: State<'_, PtyState>) -> Result<(), String> {
    // Remove the session under the lock, then release it BEFORE any blocking
    // wait. The previous version held the global lock across `child.wait()`,
    // so a slow-dying child froze write_pty / resize_pty / spawn_pty (which all
    // need this same lock) across every other terminal in the app.
    let session = {
        let mut sessions = lock_sessions(&state)?;
        sessions.remove(&session_id)
    };

    if let Some(session) = session {
        // Signal reader + monitor threads to exit.
        session.shutdown.store(true, Ordering::SeqCst);

        let child = Arc::clone(&session.child);
        // Kill + reap on a detached thread and return immediately. This command
        // is synchronous, so it runs on the main (UI) thread — any blocking wait
        // here freezes the whole webview. A stuck child (TUI ignoring the kill,
        // grandchildren, slow reap) must never stall the close. The session is
        // already removed from the map above, so UI state is consistent now.
        thread::spawn(move || {
            let mut c = match child.lock() {
                Ok(c) => c,
                Err(p) => p.into_inner(),
            };
            let _ = c.kill();
            let _ = c.wait();
        });
        // `session` (master + writer) drops here → reader thread gets EOF.
    }
    Ok(())
}

// ── Persistent storage commands ────────────────────────────────────────────────
// Using std::fs directly via app_handle.path() avoids the tauri-plugin-fs
// scope/path quirks that silently drop writes on some platforms.

fn app_data_file(app: &AppHandle, name: &str) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create app data dir: {e}"))?;
    Ok(dir.join(name))
}

#[tauri::command]
fn load_store(app: AppHandle, file: String) -> Result<String, String> {
    let path = app_data_file(&app, &file)?;
    if !path.exists() {
        return Ok(String::new()); // caller treats empty string as "no data"
    }
    std::fs::read_to_string(&path).map_err(|e| format!("Read failed: {e}"))
}

#[tauri::command]
fn save_store(app: AppHandle, file: String, data: String) -> Result<(), String> {
    let path = app_data_file(&app, &file)?;
    // Write atomically: write to a temp file, then rename.
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, &data).map_err(|e| format!("Write failed: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("Rename failed: {e}"))?;
    Ok(())
}

#[tauri::command]
fn write_file_path(path: String, content: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);

    // Only allow writing markdown files (checkpoints are always .md)
    match p.extension().and_then(|e| e.to_str()) {
        Some("md") => {}
        _ => return Err("write_file_path: only .md files are allowed".to_string()),
    }

    // Reject writes to obvious system directories.
    let mut path_lower = path.to_lowercase().replace('\\', "/");
    // Strip a Windows drive prefix (e.g. "c:") so the unix-style prefix checks
    // below also catch "C:\Windows\System32\...". The old code only used
    // starts_with on raw drive-prefixed paths, so the guard never fired on
    // Windows.
    if path_lower.len() >= 2 && path_lower.as_bytes()[1] == b':' {
        path_lower = path_lower[2..].to_string();
    }
    let blocked = [
        "/etc/", "/bin/", "/usr/bin/", "/usr/sbin/", "/sbin/",
        "/system/", "/windows/system32/", "/program files/",
        "/program files (x86)/",
    ];
    if blocked.iter().any(|prefix| path_lower.starts_with(prefix)) {
        return Err("write_file_path: writes to system directories are not allowed".to_string());
    }

    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create directory: {e}"))?;
    }
    std::fs::write(p, &content).map_err(|e| format!("Write failed: {e}"))?;
    Ok(())
}

// ── App Entry ──────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .manage(Mutex::new(HashMap::<String, PtySession>::new()))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_available_shells,
            spawn_pty,
            write_pty,
            resize_pty,
            kill_pty,
            load_store,
            save_store,
            write_file_path
        ])
        .setup(|app| {
            #[cfg(target_os = "windows")]
            {
                use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
                use windows::core::Interface;

                for (label, window) in app.webview_windows() {
                    let _ = window.with_webview(move |webview| {
                        unsafe {
                            let controller = webview.controller();
                            let settings = controller.CoreWebView2().unwrap().Settings().unwrap();
                            let settings3: ICoreWebView2Settings3 = settings.cast().unwrap();
                            let _ = settings3.SetAreBrowserAcceleratorKeysEnabled(false);
                            println!("[Tauri Setup] Disabled WebView2 accelerator keys for window: {}", label);
                        }
                    });
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
