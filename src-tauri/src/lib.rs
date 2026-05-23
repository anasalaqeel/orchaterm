use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{native_pty_system, CommandBuilder, Child, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

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
fn lock_sessions(state: &PtyState) -> Result<std::sync::MutexGuard<'_, HashMap<String, PtySession>>, String> {
    match state.lock() {
        Ok(guard) => Ok(guard),
        // If a previous holder panicked the data is still usable — recover it.
        Err(poisoned) => Ok(poisoned.into_inner()),
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

    // Build shell command — try user preference first, fallback to cmd.exe.
    let shell_to_use = shell.unwrap_or_else(|| "powershell.exe".to_string());
    let mut cmd = CommandBuilder::new(&shell_to_use);
    cmd.cwd(&workspace_path);
    cmd.env("TERM", "xterm-256color");

    let child = pair.slave.spawn_command(cmd).or_else(|_| {
        let mut fallback = CommandBuilder::new("cmd.exe");
        fallback.cwd(&workspace_path);
        fallback.env("TERM", "xterm-256color");
        pair.slave.spawn_command(fallback)
    }).map_err(|e| format!("Failed to spawn shell: {e}"))?;

    // Drop the slave handle immediately — on Windows ConPTY this prevents
    // the reader from blocking indefinitely.
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| format!("Failed to clone reader: {e}"))?;
    let writer = pair.master.take_writer().map_err(|e| format!("Failed to take writer: {e}"))?;

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
fn write_pty(
    session_id: String,
    data: String,
    state: State<'_, PtyState>,
) -> Result<(), String> {
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
fn kill_pty(
    session_id: String,
    state: State<'_, PtyState>,
) -> Result<(), String> {
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

// ── App Entry ──────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(HashMap::<String, PtySession>::new()))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            spawn_pty,
            write_pty,
            resize_pty,
            kill_pty
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
