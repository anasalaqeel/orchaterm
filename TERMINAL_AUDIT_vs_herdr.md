# Terminal Reliability Audit — Orchaterm vs herdr

**Scope:** Implementation/quality gap analysis only. Does **not** propose any change to Orchaterm's core idea, feature set, or product direction. Every recommendation preserves the current feature scope.

**Date:** 2026-07-22
**Reference project:** `herdr` v0.7.5 (`C:\Users\anasa\Desktop\herdr`) — a pure-Rust TUI agent multiplexer (ratatui + crossterm + tokio + portable-pty).
**Subject project:** Orchaterm (`C:\Users\anasa\Desktop\orchaterm`) — a Tauri 2 + React 19 + xterm.js 6 desktop app using upstream `portable-pty` 0.9.

> **Framing caveat (read first):** The two projects are *architecturally different*. herdr renders terminals **in-process** (ratatui draws panes in the host terminal; no IPC). Orchaterm renders terminals in a **WebView** via xterm.js, with bytes crossing a Rust→Tauri→JS IPC bridge. Many of herdr's "advantages" (e.g. no output channel at all) stem from being in-process and are **not directly portable**. This report isolates the *transferable* engineering lessons and maps them onto Orchaterm's Tauri architecture.

---

## TL;DR — the four things that actually matter

1. **Orchaterm does blocking PTY I/O on the Tauri command path.** `write_pty`, `resize_pty`, `kill_pty`, and `spawn_pty` are synchronous `#[tauri::command]` handlers (`src-tauri/src/lib.rs:465,743,764,791`). Tauri runs synchronous command handlers **on the main thread**; blocking work there freezes the WebView. The codebase's own comment (`lib.rs:807-811`) confirms the author already treats these as main-thread-blocking.
2. **Every PTY output chunk is double-handled on the JS main thread with no batching.** xterm's `term.write()` is called synchronously per event (`TerminalTab.tsx:501`), **plus** a *second* Tauri listener per session (`bufferWatcher.ts:145`) runs a `buffer += chunk` string concat + `clearTimeout`/`setTimeout` churn on **every** chunk (`bufferWatcher.ts:165,190-194`). Hidden background tabs keep doing all of this. This is the most likely cause of *intermittent* UI freezes during burst output.
3. **The backend output path has no backpressure.** Reader thread → coalescer thread flows over an **unbounded** `std::sync::mpsc` channel (`lib.rs:639`); under sustained high-throughput output the buffer grows without bound and the WebView event queue backs up.
4. **Unix cleanup is best-effort; shell detection ignores `$SHELL`.** No process-group/session kill and **no app-exit hook** on Unix (Windows has a proper Job Object). Shell detection hardcodes `/bin/zsh`, `/bin/bash`, … and never reads `$SHELL`, so Linux users whose shell is at `/usr/bin/zsh` silently get bash.

---

## 1. Where herdr is better (concrete, with file:line)

### 1a. The PTY read path never touches a shared runtime or the render path
herdr runs **one dedicated OS thread per PTY**, fully outside the tokio runtime:
```rust
// herdr src/pty/actor/unix.rs:378-381
std::thread::Builder::new()
    .name(format!("herdr-pty-{}", config.pane_id))
    .spawn(move || runner.run())
```
The thread is a non-blocking `poll(2)` loop (`actor/unix.rs:417-471`) woken by a self-pipe (`pty/fd.rs:86-104`). **Implication for Orchaterm:** Orchaterm already puts the *read* loop on its own thread (`lib.rs:644-668` reader, `677-738` coalescer) — good. But the **write, resize, spawn, and kill** commands stay on the main-thread command path (`lib.rs:743-823`), which is the gap.

### 1b. PTY output is consumed by a callback into an in-memory emulator — no output channel, no backpressure deadlock
```rust
// herdr src/pty/actor/unix.rs:647-663  (read_once)
let mut buf = [0u8; 8192];
match self.file.read(&mut buf) {
    Ok(n) => { let result = (self.on_read)(&buf[..n]); … }   // inline, no queue
```
The only thing that crosses to the render loop is a **coalesced render signal**, gated by an `AtomicBool`:
```rust
// herdr src/pane.rs:1920-1922
if result.request_render && !render_dirty.swap(true, Ordering::AcqRel) {
    render_notify.notify_one();
}
```
A 100 MB `cat` produces millions of reads into the emulator and **zero** queued frames. Orchaterm cannot copy this directly (it must cross IPC to xterm.js), but the *principle* — **coalesce to a bounded cadence and shed excess, never queue unbounded** — is directly portable (see fix F3, F4).

### 1c. Bounded input channel with explicit backpressure + a separate unbounded control channel
```rust
// herdr src/pty/actor/unix.rs:345-346
let (data_tx, data_rx) = mpsc::channel(ACTOR_COMMAND_BUFFER);   // const = 1024, bounded
let (control_tx, control_rx) = std_mpsc::channel();             // unbounded, separate
```
Producers await a permit (`unix.rs:115` `data_tx.reserve().await`), and a full data queue **cannot** block handoff/shutdown (proven by test `handoff_control_is_not_blocked_by_full_data_queue`, `unix.rs:1246-1278`). Orchaterm's input path is fire-and-forget `write_pty` invocations with no backpressure signal.

### 1d. Resize is coalesced ("latest wins") and applied on the same thread that reads — race-free
herdr stores the latest resize request in a `SharedPtyControls` atomic (`unix.rs:59-63`) and applies it on the actor thread (`unix.rs:702-710`, `fd.rs:220-241` via `ioctl TIOCSWINSZ`). Because resize and read share one thread, there is **no mutex between a reader thread and a resizer thread**. Orchaterm's `resize_pty` instead holds the **global session Mutex** across the resize call (`lib.rs:773-786`), serializing against every other command and against the monitor thread's exit cleanup.

### 1e. Cleanup walks the whole process session with escalating signals (no orphans)
```rust
// herdr src/pane.rs:1140-1188  (shutdown_pane_processes)
for (signal, grace) in [
    (Signal::Hangup,    Duration::from_millis(250)),
    (Signal::Terminate, Duration::from_millis(250)),
    (Signal::Kill,      Duration::from_millis(250)),
] {
    crate::platform::signal_processes(&pids, signal);   // pids = whole session, not just child
    if wait_for_processes_to_exit(…, grace) { return; }
}
```
PID set is built by **session enumeration**: `/proc` walk by session id on Linux (`platform/linux.rs:294-317`), `proc_listallpids` by `getsid` on macOS (`platform/macos.rs:970-984`), ToolHelp descendant tree on Windows (`platform/windows.rs:542-563`). Reaping is liveness-aware (`pane.rs:1101-1138`) and uses `spawn_blocking(child.wait())` (`pane.rs:1877-1900`).
**Orchaterm contrast:** On Unix, `kill_pty` calls only `child.kill()` on the **direct child** (`lib.rs:817`); there is **no `killpg`/session kill** anywhere, and **no `RunEvent::Exit` / `on_window_event` cleanup hook** (`.run(...)` at `lib.rs:934` with no exit handler). Windows is handled well (kill-on-close Job Object, `lib.rs:556-557`), but Linux/macOS rely on implicit SIGHUP when the master fd drops — anything `disown`ed or daemonized survives as an orphan.

### 1f. Shell detection respects `$SHELL`; Orchaterm ignores it
```rust
// herdr src/pane.rs:1206-1237
fn pane_shell_from(configured_shell: &str, env_shell: Option<String>) -> String {
    if !configured_shell.trim().is_empty() { return configured_shell.to_string(); }
    #[cfg(not(windows))] env_shell.map(|s| s.trim().to_string())   // ← uses $SHELL
        .filter(|s| !s.is_empty()).unwrap_or_else(default_pane_shell)
}
```
**Orchaterm contrast:** `get_available_shells`/`platform_default_shell` (`lib.rs:125-243, 426-448`) **never read `$SHELL`**. The Unix absolute list is hardcoded to `/bin/zsh`, `/bin/bash`, `/bin/sh`, `/bin/dash` (`lib.rs:141-146`); the by-name list only covers `fish`, `nu`, `elvish` (`lib.rs:162`). A Linux user whose login shell is `/usr/bin/zsh` (extremely common on Debian/Ubuntu/Fedora) gets **bash**; a macOS user with the same `$SHELL=zsh` gets **zsh**. Different shell → different rc/PATH/aliases → "behaves inconsistently."

### 1g. State is separated from runtime (testability + reliability)
herdr keeps `TerminalState` as pure data (`terminal/state.rs:99-127` — "no channels, no async, no PTY") and `TerminalRuntime`/`PaneRuntime` as thin I/O glue that owns the live actor (`terminal/runtime.rs`, `runtime_registry.rs`). The module doc (`runtime_registry.rs:6-9`) states the registry is kept *outside* `AppState` so "pure state can stay focused on workspace/pane metadata while the server layer owns PTYs." Orchaterm has a single 936-line `lib.rs` holding state, all four commands, three thread loops, UTF-8 logic, shell detection, and Windows Job-Object code.

### 1h. Vendored `portable-pty` — Windows reliability patch (relevant to cross-platform hygiene)
herdr pins `portable-pty = "=0.9.0"` and replaces it via `[patch.crates-io]` (`Cargo.toml:31,46-47`). There are **exactly two patches, both Windows-only** (documented in `vendor/portable-pty.patches.md`, machine-checked by `scripts/test_vendor_portable_pty.py:87-112`):
- **Patch 0001** (`vendor/patches/portable-pty/0001-force-system-conpty.patch` → `win/psuedocon.rs:45-53`): forces loading ConPTY from `kernel32.dll` instead of probing a sideloaded `conpty.dll` on PATH. Upstream's PATH probe can load a foreign/mismatched `conpty.dll` (from another terminal app), causing version-mismatch freezes and broken resize delivery. **This is plausibly one Windows freeze class Orchaterm (plain upstream) still carries.** (Issue `ogulcancelik/herdr#761`.)
- **Patch 0002** (`win/cmdbuilder.rs`): adds `raw_arg()` so `cmd.exe /d /c <tail>` is not ArgvQuote-escaped. Windows correctness fix.

> **Important:** the Unix/macOS reliability advantages are **not** in these patches. They come entirely from herdr's own architecture (1a–1e) and shell policy (1f). Do not expect to fix Linux/macOS by vendoring portable-pty — that only helps Windows.

---

## 2. Where we're already equal or better (do NOT touch)

- **UTF-8 streaming integrity.** `drain_valid_utf8` (`lib.rs:292-330`) correctly carries split multibyte tails across reads and flushes ≥4-byte invalid tails instead of hoarding them — well-tested (`lib.rs:332-408`). This is exactly where PTY frontends usually corrupt emoji/box-drawing; Orchaterm does not. **Equal-to or better than herdr's parse path in this narrow respect.**
- **Output coalescing exists.** The coalescer thread (`lib.rs:677-738`) already debounces to ≤10 ms / 32 KB before emitting — Orchaterm is *not* naively emitting one event per read. (herdr doesn't need one because it has no output channel; the comparison is moot, but Orchaterm is not naive here.) Keep the coalescer; the issue is the *unbounded feed into it*, not its existence.
- **Input chunking on paste.** `ptyUtils.ts:36-52` splits large writes into 80-char chunks with an 8 ms delay and a surrogate-pair guard (`chunkEnd`, `ptyUtils.ts:9-20`), unit-tested (`tests/ptyUtils.test.ts`). Solid.
- **Windows process-tree cleanup.** Kill-on-close Job Object (`lib.rs:19-81`, assigned `556-557`, `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) is correctly implemented — arguably simpler and more robust than herdr's enumeration+escalation on Windows. Keep as-is.
- **Frontend resize handling.** `ResizeObserver` is debounced 100 ms + double-rAF (`TerminalTab.tsx:532-551`), `safeFit` pre-probes `proposeDimensions()` to avoid the zero-size crash (`57-66`), and `term.onResize`→`resize_pty` is guarded against pixel-noise resize loops (`469-474`). This is careful, production-grade code. herdr has no JS resize path (it's in-process), so there's nothing to learn here.
- **`TerminalTab` listener/dispose hygiene (in-tab).** The per-tab `pty-data`/`pty-exit` listeners are correctly unlistened on unmount, including an async-resolution race via a `cancelled` flag (`TerminalTab.tsx:482,504-509,520-522`), and addons are disposed before `term.dispose()` (`624-626`). No leak *inside* a tab. (The leak is elsewhere — see 3d.)
- **Defensive backend touches.** `clamp_dims` (`lib.rs:276-278`) prevents 0×0 ConPTY crashes; `lock_sessions` recovers from mutex poison (`411-419`); the writer is stored behind its own `Arc<Mutex>` so writes don't block other sessions' resize/kill (`246-247`).
- **Modern stack.** React 19, xterm 6, Tauri 2.11. Nothing to upgrade for reliability reasons.

---

## 3. Root cause analysis: terminal freezing

Ranked by evidence strength. Each item states what the code literally does, why it freezes, and confidence.

### 3a. [HIGH] Frontend main-thread saturation: synchronous `term.write` **plus** a second per-chunk listener, on every chunk, for every tab (including hidden ones)
- **Evidence:** `TerminalTab.tsx:493-502` registers `listen('pty-data-{id}')` and calls `term.write(data)` synchronously in the callback (`:501`). Independently, `bufferWatcher.ts:145-147` registers **a second** `listen('pty-data-{id}')` for every session (wired unconditionally via `DashboardContext.tsx:670-677` → `sessionContinuationService.ts:83-85` → `bufferWatcher.registerSession`). On every chunk, `bufferWatcher.onData` does `entry.buffer.buffer += chunk` (`bufferWatcher.ts:165`) and a `clearTimeout`/`setTimeout` pair (`:190-194`) **before** any throttle (the throttle only gates the ANSI/marker scan). All sessions stay mounted simultaneously; inactive tabs are hidden with `visibility:hidden` (`TerminalContainer.tsx:1276-1305`, comment: "so PTYs stay alive"), and their WebGL renderer is detached when hidden (`TerminalTab.tsx:655-657`), so they run xterm's slower **DOM renderer** off-screen.
- **Why it freezes:** For every output chunk, the JS main thread does: xterm parse/write for the visible tab **+** the same for every hidden tab **+** a bufferWatcher string concat + timer reset for every session. Under burst output (a build, `npm install`, an agent streaming, `cat` of a file) this saturates the single main thread → dropped frames → "freezes intermittently," then "catches up" when output pauses. This matches the reported symptom precisely and is workload-triggered.
- **Confidence: HIGH** that this is *a* major contributor. xterm 6's internal `_writeBuffer` slices parsing on a timer, which partially mitigates — but the second-listener work and hidden-tab work run unbatched regardless.

### 3b. [HIGH] Blocking `write_pty` on the main-thread command path
- **Evidence:** `write_pty` is a synchronous command (`lib.rs:743`). Its body does `writer.write_all(data.as_bytes())` + `writer.flush()` (`lib.rs:755-759`). Tauri 2 runs synchronous command handlers on the **main thread** (official docs: "Asynchronous commands are preferred … to perform heavy work in a manner that doesn't result in UI freezes"; non-async handlers run on the main thread). The codebase's own comment on the sibling `kill_pty` (`lib.rs:807-811`) states sync commands "run on the main (UI) thread." `write_all` retries until all bytes are written; on Unix, writing to the PTY master fills the kernel slave-input buffer, and if the child isn't draining stdin fast enough (slow TUI, frozen program, large paste), `write_all` blocks until space frees.
- **Why it freezes:** While the main thread is blocked in `write_all`+`flush`, **all** Tauri command dispatch is suspended — including `kill_pty`/`resize_pty`/`spawn_pty` for *other* tabs. The user can't even close the offending tab until the write unblocks.
- **Confidence: HIGH** that this is a real freeze path. Caveat: the `#[tauri::command(async)]` macro form on a sync function is unusual; its exact dispatch (main thread vs runtime pool) is the one thing worth an empirical check, but the fix (move blocking I/O off the sync command path) is correct **regardless** of which it is. The asymmetry in the codebase — reads are painstakingly moved to dedicated threads (`644-738`) while writes are left on the command path — strongly suggests the author already learned reads can't live there.

### 3c. [MED] Unbounded output channel + bounded emit rate
- **Evidence:** Reader→coalescer flows over an **unbounded** `std::sync::mpsc::channel::<Vec<u8>>()` (`lib.rs:639`). The coalescer drains at a bounded cadence (first chunk + up to 10 ms / 32 KB per cycle, `lib.rs:688-727`) then `app_handle.emit`s (`:727`).
- **Why it freezes:** `emit` throughput is finite (JSON serialization + WebView dispatch). If a producer exceeds the coalescer's drain rate (sustained >~3.2 MB/s — large file `cat`, very chatty agent, verbose build), the channel grows without bound → rising memory, allocator pressure, and growing latency to the WebView = a freeze that "catches up" later.
- **Confidence: MED.** The unbounded channel and finite emit rate are literal facts; whether it grows depends on workload. Real but likely secondary to 3a for the reported "intermittent" symptom.

### 3d. [MED] `bufferWatcher` leak: closed tabs never unregister their listener or buffer
- **Evidence:** `closeTab` (`TerminalContainer.tsx:562-571`) calls `kill_pty` + `removePanesBySession` + `setSessions(filter)` — but **not** `bufferWatcher.unwatch`. `removeTerminalSession` (`DashboardContext.tsx:679-682`) calls `stopMonitoring` (unsubscribes summary callbacks) — but **not** `bufferWatcher.unwatch`. The **only** production `unwatch` call site is `orchestratorEngine.ts:158` (on task completion); every other call is in tests (`grep`-confirmed). `unwatch` (`bufferWatcher.ts:559-570`) is the only thing that calls `entry.unlisten()` and deletes the `WatchEntry`.
- **Why it freezes:** Every opened-then-closed tab permanently leaks a `WatchEntry` in the singleton Map — including its Tauri listener registration and its buffer string (up to 256 KB, `bufferWatcher.ts:56`). Leaked listeners are dormant (the PTY is dead), so this is a **memory leak + GC-pressure** source, not direct CPU. Over a long session of opening/closing many tabs, growing heap → longer GC pauses → intermittent stalls.
- **Confidence: MED** as a freeze explanation; **HIGH** as a genuine defect worth fixing regardless.

### 3e. [LOW-MED] Compounding contributors
- WebGL attach/detach on every visibility change (`TerminalTab.tsx:655-683`); Chromium caps concurrent WebGL contexts (~16, comment `641-645`). Rapid pane switching across many tabs can exhaust contexts; the next `new WebglAddon()` throws, is swallowed by try/catch (`671-675`), and the tab silently downgrades to the slow DOM renderer — matching "behaves inconsistently across tabs."
- `terminalSessions` in context (`DashboardContext.tsx:261`) + `TerminalTab` not `React.memo`'d → every `updateTerminalSession` (checkpoint toggles, reorder, title/color edits) re-renders all open tabs. Stutter, not a hard freeze.
- Sync storage commands do disk I/O on the main thread (`load_store` `838`, `save_store` `847`, `write_file_path` `857`) — non-PTY but same freeze surface.

### 3f. What is NOT the cause (verified absences)
- No `Mutex` held across the blocking `reader.read()` (the reader holds only the channel sender).
- `kill_pty` correctly avoids holding the global lock across `wait()` (offloaded to a detached thread, `lib.rs:812-819`).
- The coalescer's UTF-8 `carry` is bounded (`drain_valid_utf8`, `≥4`-byte tails flushed).
- No `tokio::spawn`/`spawn_blocking` at all — nothing on the async runtime's core is doing blocking I/O (so no async-runtime stall).

---

## 4. Root cause analysis: cross-platform inconsistency (Linux/macOS)

### 4a. [HIGH] Shell detection ignores `$SHELL` and misses common install paths → different shell per OS
- **Evidence:** `$SHELL` is never read (`lib.rs:125-243, 426-448`). Unix absolute list is `/bin/zsh`, `/bin/bash`, `/bin/sh`, `/bin/dash` (`lib.rs:141-146`); by-name PATH lookup only covers `fish`, `nu`, `elvish` (`lib.rs:162`). `/usr/bin/zsh` and `/usr/bin/bash` (the default locations on most Linux distros) and Homebrew `/opt/homebrew/bin/zsh` (Apple Silicon) are **not** detected.
- **Why it diverges:** A Linux user whose login shell is `/usr/bin/zsh` falls back to `/bin/bash`; a macOS user with the same `$SHELL=zsh` gets zsh (because `/bin/zsh` exists). Different shell → different rc files → different `PATH`/aliases/nvm/conda/pyenv → "inconsistent behavior across Linux and macOS." This is the single most defensible explanation for the cross-platform inconsistency.
- **Note (nuance):** Orchaterm **does** launch Unix shells with the `-l` login flag (`lib.rs:507-509`), so shells that *are* correctly detected source their profile and get a proper `PATH`. **Orchaterm does NOT have the classic "macOS GUI app missing `/opt/homebrew/bin`" bug** — that's solved by `-l`. herdr solves the same thing differently (login-shell policy + upstream's `arg0("-basename")` trick, `pane.rs:1276-1285`). So the cross-platform fix here is **detection**, not PATH enrichment.
- **Confidence: HIGH.**

### 4b. [MED] No process-group/session kill and no app-exit hook on Unix → orphaned processes
- **Evidence:** No `killpg`/`setsid`/session-kill anywhere in `lib.rs`. `kill_pty` only calls `child.kill()` on the direct child (`lib.rs:817`). There is **no `RunEvent::Exit` / `on_window_event` cleanup** (`.run(...)` at `lib.rs:934`, `.setup` at `914-933` is Windows-only). On Unix, child cleanup relies on implicit SIGHUP when the master fd drops.
- **Why it diverges:** Windows has a proper kill-on-close Job Object (`lib.rs:556-557`) that reliably kills the whole tree. Unix gets best-effort SIGHUP — which kills the shell, but anything `disown`ed, daemonized (`&` + `setsid`), or with a SIGHUP handler survives as an orphan holding its port. So "close the app on Linux/macOS and my dev server / agent is still running / port is stuck" — a cross-platform inconsistency in cleanup semantics.
- **Confidence: MED** as a freeze cause; **HIGH** as a real cross-platform behavioral divergence.

### 4c. [LOW] Unguarded Windows error code logged on Unix
- **Evidence:** `if code != 109 { eprintln!(...) }` (`lib.rs:661`) runs on all platforms. On Linux, the master read returns `EIO` (code 5) when the slave closes → `5 != 109` → a spurious `[pty-reader-io-{sid}] read error:` line on every shell exit. macOS returns `EOF (0)`, handled silently at `:653`. Both correctly break the loop; this is noise, not a bug. (Linux EIO-on-pty-close vs macOS EOF is the classic portable-pty divergence — handled correctly here.)

### 4d. [LOW] macOS ships bash 3.2 at `/bin/bash`; Linux ships bash 5.x
- macOS bash is GPLv2 3.2 (`/bin/bash`, detected at `lib.rs:142`); Linux distros ship 5.x. Scripts using `mapfile`, `coproc`, or newer brace expansions work on Linux but fail on macOS. Behavioral, not a freeze.

### 4e. [LOW for Linux/macOS] Unpatched upstream `portable-pty`
- `Cargo.toml:29` declares `portable-pty = "0.9"` (resolves 0.9.0, no patch). herdr's vendor patches are **Windows-only** (1h). The Unix backend of portable-pty 0.9 is stable; **do not expect vendoring to fix Linux/macOS.** The one upstream-known issue the codebase comments on (`lib.rs:584-588`, reader blocking after child exit) is a **Windows** defect already mitigated by the `try_wait` poll.

---

## 5. Recommended fixes (prioritized, scope-preserving)

Every fix is an implementation/reliability change only — no new features, no product-direction change. Tied to a finding above.

### Quick wins (low risk, high impact, small diff)

- **Q1 — Call `bufferWatcher.unwatch(sessionId)` when a tab closes.** *(Finding 3d.)* In `closeTab` (`TerminalContainer.tsx:562-571`) and `removeTerminalSession` (`DashboardContext.tsx:679-682`), call `bufferWatcher.unwatch(sessionId)` before/after `kill_pty`. Stops the unbounded leak of `WatchEntry` + Tauri listener + up to 256 KB buffer per closed tab. ~2 lines per site.
- **Q2 — Respect `$SHELL` for shell detection.** *(Finding 4a.)* In `platform_default_shell` (`lib.rs:426-448`) and `get_available_shells` (`lib.rs:125-243`), prefer `std::env::var("SHELL")` (when set and the path exists) before falling back to the hardcoded list; also add `/usr/bin/zsh`, `/usr/bin/bash` (and optionally `/opt/homebrew/bin/zsh`) to the absolute list. Eliminates the Linux-zsh-gets-bash inconsistency. Preserve the existing `-l` login flag (do not remove — it is what gives macOS a correct `PATH`).
- **Q3 — Make `write_pty` non-blocking on the command path.** *(Finding 3b.)* Easiest correct version: keep the command synchronous but move the `write_all`+`flush` onto the existing per-session machinery — e.g. send the bytes through a bounded `mpsc` to a dedicated **writer thread** per session (mirroring the reader/coalescer pattern at `lib.rs:644-738`), so the command returns immediately after enqueueing. This removes the main-thread blocking write entirely while preserving the exact `write_pty` IPC contract the frontend uses. (Alternative: convert to `async fn` + `spawn_blocking`, but a per-session writer thread is the cleaner match for this codebase's existing design.)
- **Q4 — Coalesce xterm writes per animation frame.** *(Finding 3a.)* In the `pty-data` listener (`TerminalTab.tsx:493-502`), accumulate chunks into a buffer and flush with a single `term.write(concatenated)` inside one `requestAnimationFrame`, rather than `term.write` per event. Removes the per-chunk xterm parse overhead on the JS main thread. No behavior change for the user.
- **Q5 — Reduce/defer work for hidden tabs.** *(Finding 3a.)* When a tab is not visible, skip the per-chunk `term.write` (buffer it and flush on show) or, at minimum, skip the bufferWatcher scan path for hidden sessions. Frees the main thread during burst output in background tabs.

### Deeper fixes (higher value, larger change)

- **D1 — Bound the output channel and shed on overflow.** *(Finding 3c.)* Replace the unbounded `std::sync::mpsc` at `lib.rs:639` with a bounded channel (e.g. tokio `mpsc` with a few-hundred-message cap, or a `crossbeam` bounded queue). On overflow, **coalesce/drop** the oldest unflushed chunks (terminal output is lossy-tolerant for display) rather than growing unbounded. This is the Tauri-native analog of herdr's "no output channel / coalesced render signal" principle (1b) — Orchaterm can't eliminate the channel (it must cross IPC), but it can bound it.
- **D2 — Unix process-tree cleanup + app-exit hook.** *(Finding 4b.)* (a) In `kill_pty` and on session drop, after `child.kill()`, also kill the child's **process group** (`libc::killpg(pgid, …)` / `setsid`-aware) with a SIGHUP→SIGTERM→SIGKILL escalation (mirroring herdr `pane.rs:1140-1188`). portable-pty already runs the child in a new session via `setsid` (upstream), so the group kill is well-defined. (b) Add a `RunEvent::Exit` / `on_window_event` hook in `run()` (`lib.rs:895-936`) that iterates all live sessions and tears them down explicitly, so quitting the app on Linux/macOS doesn't orphan grandchildren. Preserves the existing Windows Job Object path.
- **D3 — Move `resize_pty` (and the spawn heavy-lifting) off the main-thread command path.** *(Finding 1d / 3b.)* Deliver resize through the same per-session channel as writes (latest-wins coalescing — discard queued resizes when a newer one arrives), so the global session Mutex (`lib.rs:773-786`) is no longer held across the resize call and drag-resize can't serialize against other commands. `spawn_pty`'s `openpty`+`spawn_command`+thread-spawn (`465-741`) can similarly be moved to a worker so opening a tab doesn't stutter the UI.
- **D4 — Vendor/patch `portable-pty` to force system ConPTY (Windows).** *(Finding 1h.)* If Windows freezes are also reported, apply herdr's patch 0001 (`force kernel32.dll` ConPTY, `psuedocon.rs`) to avoid loading a foreign `conpty.dll` from PATH. Low priority if the reported problem is Linux/macOS-only; note this is the **only** part of herdr's vendor diff that could matter for reliability, and it is Windows-only.
- **D5 — Split `lib.rs` into modules (state / commands / pty io / shell-detect / win-job).** *(Finding 1g.)* Reliability-adjacent: the 936-line monolith mixes a global `Mutex<HashMap>` with four commands, three thread loops, UTF-8 logic, shell tables, and Windows Job-Object FFI. Separating these (and isolating the writer/resize behind a per-session actor struct) makes the backpressure and lifecycle fixes above easier to get right and test. Pure refactor — no behavior change.

### Suggested order
Q1 → Q3 → Q4 → Q5 → Q2 (these alone should eliminate most intermittent freezes and the shell-detection inconsistency) → D1 → D2 → D3 → D5 → D4 (only if Windows freezes are reported).

---

## Appendix — key file references

**Orchaterm (`src-tauri/src/lib.rs` unless noted)**
- Sync command handlers: `465` (`spawn_pty`), `743` (`write_pty`), `764` (`resize_pty`), `791` (`kill_pty`); main-thread comment `807-811`.
- Blocking write: `755-759`. Reader thread `644-668`. Coalescer `677-738`. Unbounded channel `639`. Monitor `594-631`.
- Shell detection: `125-243`, `426-448`; hardcoded list `141-146`; `-l` flag `507-509`.
- Windows Job Object `19-81`, `556-557`. App entry / no exit hook `895-936`.
- Frontend: `TerminalTab.tsx:493-513` (listener+write), `655-683` (WebGL); `TerminalContainer.tsx:1276-1305` (all tabs mounted), `562-571` (closeTab); `bufferWatcher.ts:145-147` (2nd listener), `161-195` (per-chunk onData), `559-570` (unwatch); `DashboardContext.tsx:679-682` (removeTerminalSession); `sessionContinuationService.ts:83-85`; `orchestratorEngine.ts:158` (only unwatch call).

**herdr (`src/...`)**
- Dedicated PTY thread: `pty/actor/unix.rs:378-381`; poll loop `417-471`; read_once `647-663`; wake pipe `pty/fd.rs:86-104`; resize `pty/fd.rs:220-241`.
- Channels: `pty/actor/unix.rs:345-346`; render coalesce `pane.rs:1920-1922`.
- Cleanup: `pane.rs:1140-1188` (SIGHUP→TERM→KILL), `1101-1138` (liveness reaping), `1877-1900` (spawn_blocking wait).
- Shell policy: `pane.rs:1206-1237` (uses `$SHELL`), `1276-1285` (login on macOS).
- Vendor patches: `vendor/portable-pty.patches.md`; `vendor/patches/portable-pty/0001-force-system-conpty.patch`; `vendor/patches/portable-pty/0002-windows-raw-command-tail.patch`; guard `scripts/test_vendor_portable_pty.py:87-112`.
