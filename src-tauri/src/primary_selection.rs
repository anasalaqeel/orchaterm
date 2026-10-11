// ── Linux PRIMARY selection (middle-click paste buffer) ───────────────────────
//
// The clipboard-manager plugin (arboard) only handles the CLIPBOARD selection.
// The PRIMARY selection — set by merely selecting text, pasted with the middle
// mouse button — needs its own backend:
//   * Wayland: ext/wlr-data-control via wl-clipboard-rs (spawns a serving
//     thread, so ownership outlives this call)
//   * X11/XWayland: x11-clipboard (kept alive in a process-wide instance; its
//     serving thread dies with it, hence the OnceLock)
// On Wayland sessions both are written so XWayland apps stay in sync; reads
// try Wayland first and fall back to X11.

#[tauri::command]
pub async fn read_primary_selection() -> Result<Option<String>, String> {
    #[cfg(target_os = "linux")]
    return tauri::async_runtime::spawn_blocking(linux::read)
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r.map_err(|e| e.to_string()));
    #[cfg(not(target_os = "linux"))]
    Ok(None)
}

#[tauri::command]
pub async fn write_primary_selection(text: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    return tauri::async_runtime::spawn_blocking(move || linux::write(&text))
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r.map_err(|e| e.to_string()));
    #[cfg(not(target_os = "linux"))]
    {
        let _ = text;
        Ok(())
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use std::io::Read;
    use std::sync::OnceLock;

    const X11_READ_TIMEOUT_MS: u64 = 500;

    fn on_wayland() -> bool {
        std::env::var_os("WAYLAND_DISPLAY").is_some()
    }

    fn clean(bytes: Vec<u8>) -> Option<String> {
        let text = String::from_utf8_lossy(&bytes);
        let trimmed = text.trim_end_matches('\0');
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    }

    // The instance must outlive our ownership of the selection: its internal
    // thread answers paste requests, so it is created once and never dropped.
    fn x11() -> Result<&'static x11_clipboard::Clipboard, String> {
        static CLIPBOARD: OnceLock<Result<x11_clipboard::Clipboard, String>> = OnceLock::new();
        CLIPBOARD
            .get_or_init(|| x11_clipboard::Clipboard::new().map_err(|e| e.to_string()))
            .as_ref()
            .map_err(Clone::clone)
    }

    fn read_x11() -> Result<Option<String>, String> {
        let cb = x11()?;
        let atoms = &cb.getter.atoms;
        let bytes = cb
            .load(
                atoms.primary,
                atoms.utf8_string,
                atoms.property,
                std::time::Duration::from_millis(X11_READ_TIMEOUT_MS),
            )
            .map_err(|e| e.to_string())?;
        Ok(clean(bytes))
    }

    fn read_wayland() -> Result<Option<String>, String> {
        use wl_clipboard_rs::paste::{get_contents, ClipboardType, MimeType, Seat};
        let (mut reader, _mime) =
            get_contents(ClipboardType::Primary, Seat::All, MimeType::Text)
                .map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        reader.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        Ok(clean(bytes))
    }

    fn write_x11(text: &str) -> Result<(), String> {
        let cb = x11()?;
        let atoms = &cb.getter.atoms;
        cb.store(atoms.primary, atoms.utf8_string, text.as_bytes().to_vec())
            .map_err(|e| e.to_string())
    }

    fn write_wayland(text: &str) -> Result<(), String> {
        use wl_clipboard_rs::copy::{ClipboardType, MimeType, Options, Source};
        let mut opts = Options::new();
        opts.clipboard(ClipboardType::Primary);
        opts.copy(Source::Bytes(text.as_bytes().into()), MimeType::Text)
            .map_err(|e| e.to_string())
    }

    pub fn read() -> Result<Option<String>, String> {
        // Wayland first; an empty or failed read falls through to X11 so
        // X11-owned selections are still found when the compositor doesn't
        // sync them into the Wayland primary.
        let wayland_text = if on_wayland() { Some(read_wayland()) } else { None };
        if matches!(&wayland_text, Some(Ok(Some(_)))) {
            return wayland_text.unwrap();
        }
        match read_x11() {
            Ok(Some(text)) => Ok(Some(text)),
            Ok(None) => wayland_text.unwrap_or(Ok(None)),
            Err(x11_err) => match wayland_text {
                // A readable-but-empty Wayland primary is a valid "nothing
                // selected" answer; only surface errors when both backends
                // have nothing usable.
                Some(Ok(None)) => Ok(None),
                Some(Err(w)) => Err(format!("wayland: {w}; x11: {x11_err}")),
                None => Err(x11_err),
            },
        }
    }

    pub fn write(text: &str) -> Result<(), String> {
        let mut wayland_err = None;
        if on_wayland() {
            match write_wayland(text) {
                Ok(()) => {
                    // Also mirror into XWayland's primary so X11-only apps see
                    // the selection even when the compositor doesn't sync it.
                    let _ = write_x11(text);
                    return Ok(());
                }
                Err(e) => wayland_err = Some(e),
            }
        }
        write_x11(text).map_err(|x11_err| match wayland_err {
            Some(w) => format!("wayland: {w}; x11: {x11_err}"),
            None => x11_err,
        })
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::linux::clean;

    #[test]
    fn empty_selections_become_none() {
        assert_eq!(clean(Vec::new()), None);
        assert_eq!(clean(b"\0\0".to_vec()), None);
        assert_eq!(clean(b"   ".to_vec()), Some("   ".to_string()));
    }

    #[test]
    fn trailing_nul_is_trimmed() {
        assert_eq!(clean(b"ls -la\0".to_vec()), Some("ls -la".to_string()));
    }

    #[test]
    fn meaningful_whitespace_is_kept() {
        assert_eq!(clean(b"cargo build\r\n".to_vec()), Some("cargo build\r\n".to_string()));
    }
}