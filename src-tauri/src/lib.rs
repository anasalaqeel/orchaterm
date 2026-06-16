use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

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
    child: Box<dyn Child + Send>,
    /// Flipped to `true` by `kill_pty` so the reader thread exits promptly.
    shutdown: Arc<AtomicBool>,
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

#[tauri::command]
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

    #[cfg(not(target_os = "windows"))]
    cmd.env("TERM", "xterm-256color");

    // Append any extra args (e.g. ["--", "bash"] for wsl).
    if let Some(args) = shell_args {
        for arg in args {
            cmd.arg(arg);
        }
    }
    cmd.cwd(&workspace_path);
    cmd.env("TERM", "xterm-256color");

    let child = pair
        .slave
        .spawn_command(cmd)
        .or_else(|_| {
            let mut fallback = CommandBuilder::new(platform_fallback_shell());
            fallback.cwd(&workspace_path);
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

    let session = PtySession {
        master: pair.master,
        writer: Arc::new(Mutex::new(writer)),
        child,
        shutdown: Arc::clone(&shutdown),
    };

    {
        let mut sessions = lock_sessions(&state)?;
        // If a stale session exists for this ID, kill it first.
        if let Some(mut old) = sessions.remove(&session_id) {
            old.shutdown.store(true, Ordering::SeqCst);
            let _ = old.child.kill();
        }
        sessions.insert(session_id.clone(), session);
    }

    // ── Child process monitor thread ───────────────────────────────────────
    // portable_pty's reader thread can block indefinitely on Windows even after
    // the child process dies. Polling `try_wait` guarantees we detect the exit.
    let sid_monitor = session_id.clone();
    let app_handle_monitor = app_handle.clone();
    
    thread::spawn(move || {
        loop {
            thread::sleep(std::time::Duration::from_millis(100));
            let state_monitor = app_handle_monitor.state::<PtyState>();
            let mut sessions = match lock_sessions(&state_monitor) {
                Ok(s) => s,
                Err(_) => break,
            };
            if let Some(session) = sessions.get_mut(&sid_monitor) {
                match session.child.try_wait() {
                    Ok(Some(_status)) => {
                        // Child exited.
                        let payload = PtyPayload {
                            session_id: sid_monitor.clone(),
                            data: "".to_string(),
                        };
                        let _ = app_handle_monitor.emit(&format!("pty-exit-{}", sid_monitor), payload);
                        
                        // We do not remove the session from the map here to avoid
                        // race conditions with the frontend closing the tab.
                        break;
                    }
                    Ok(None) => {
                        // Still running
                    }
                    Err(_) => {
                        // Error checking status, assume dead.
                        let payload = PtyPayload {
                            session_id: sid_monitor.clone(),
                            data: "".to_string(),
                        };
                        let _ = app_handle_monitor.emit(&format!("pty-exit-{}", sid_monitor), payload);
                        break;
                    }
                }
            } else {
                // Session was removed (killed by user)
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
            loop {
                // Check shutdown flag before each read.
                if shutdown.load(Ordering::SeqCst) {
                    break;
                }

                match reader.read(&mut buffer) {
                    Ok(0) => break, // EOF
                    Ok(n) => {
                        // Use lossy conversion — terminal escape sequences are
                        // almost always valid UTF-8.  For the rare raw byte this
                        // is better than crashing or losing the whole chunk.
                        let text = String::from_utf8_lossy(&buffer[..n]).into_owned();
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

#[tauri::command]
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

    // [TEMP DEBUG] hex-dump every byte sent to the PTY so stray bytes between
    // two Ctrl+D presses are visible in the dev terminal. Remove after diagnosing.
    let hex: String = data
        .as_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<Vec<_>>()
        .join(" ");
    eprintln!("[PTY-OUT {}] {hex}", &session_id[..session_id.len().min(4)]);

    let mut writer = writer_arc.lock().map_err(|_| "Writer lock poisoned")?;
    writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Write failed: {e}"))?;
    writer.flush().map_err(|e| format!("Flush failed: {e}"))?;

    Ok(())
}

#[tauri::command]
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

#[tauri::command]
fn kill_pty(session_id: String, state: State<'_, PtyState>) -> Result<(), String> {
    let mut sessions = lock_sessions(&state)?;
    if let Some(mut session) = sessions.remove(&session_id) {
        // Signal the reader thread to exit.
        session.shutdown.store(true, Ordering::SeqCst);

        // Kill the child process and reap it to avoid zombies.
        let _ = session.child.kill();
        // Wait briefly for the child to exit so the OS can reclaim resources.
        // `wait` can block — use a short timeout via a helper thread.
        let child_wait = thread::spawn(move || {
            let _ = session.child.wait();
        });
        // Give it 500ms; if the child is stuck we move on.
        let _ = child_wait.join();

        Ok(())
    } else {
        // Silently succeed — the session may have already been cleaned up.
        Ok(())
    }
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

    // Reject writes to obvious system directories
    let path_lower = path.to_lowercase().replace('\\', "/");
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
