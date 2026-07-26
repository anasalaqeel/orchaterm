# Orchaterm vs herdr — Full Comparison & Improvement Plan

> **This document supersedes and expands the earlier terminal-only audit.**
> The original "Terminal Reliability Audit" is preserved in full as **Appendix A** (still accurate and the most actionable section); the new broader findings (persistence, detection, programmability, architecture, project maturity) and the **Implementation Plan** are added on top.

**Date:** 2026-07-26 (findings refreshed against current source on both repos)
**Reference project:** `herdr` v0.7.5 (`C:\Users\anasa\Desktop\herdr`) — pure-Rust TUI agent multiplexer (ratatui + crossterm + tokio + portable-pty + **vendored Ghostty VT**), AGPL-3.0, shipping.
**Subject project:** Orchaterm (`C:\Users\anasa\Desktop\orchaterm`) — Tauri 2 + React 19 + xterm.js 6 desktop app, in active development.

> **Framing caveat (read first):** The two projects are *architecturally different*. herdr renders terminals **in-process** (ratatui draws panes in the host terminal; vendored Ghostty VT parses bytes natively; **no IPC**). Orchaterm renders terminals in a **WebView** via xterm.js, with bytes crossing a Rust→Tauri→JS IPC bridge. Many of herdr's "advantages" (no output channel, native-VT throughput) stem from being in-process and are **not directly portable** to a WebView app. This report isolates the *transferable* lessons and maps them onto Orchaterm's Tauri architecture — and is equally clear about what is **not worth chasing** (see "Don't bother" in the plan).

---

## Table of Contents

1. [TL;DR — the strategic call](#tldr--the-strategic-call)
2. [Part A — Where herdr is better (the gaps)](#part-a--where-herdr-is-better-the-gaps)
   - A1. Sessions that never die (persistence / detach / remote) — **the #1 product gap**
   - A2. Terminal reliability under load (the freezes)
   - A3. Agent detection (non-cooperative manifests vs sentinel tokens)
   - A4. Programmability (socket API / CLI / plugins / agent-skill vs none)
   - A5. Architecture & code discipline
   - A6. Project maturity (testing / CI / release / docs / license)
3. [Part B — Where Orchaterm is better / our real moat](#part-b--where-orchaterm-is-better--our-real-moat)
4. [Part C — Equal or not worth chasing](#part-c--equal-or-not-worth-chasing)
5. [Implementation Plan (prioritized, trackable)](#implementation-plan-prioritized-trackable)
6. [Appendix A — Detailed terminal-reliability analysis & fix table](#appendix-a--detailed-terminal-reliability-analysis--fix-table)
7. [Appendix B — Evidence index (file:line)](#appendix-b--evidence-index-fileline)

---

## TL;DR — the strategic call

herdr is a **mature, shipping, production-grade** project. Orchaterm is an **ambitious early-stage prototype** with a genuinely different — and in places *ahead* — idea, but missing most of the engineering foundation that makes software trustworthy.

**Don't try to out-multiplex herdr on her home turf** (TUI, terminal fidelity, never-die TUI sessions). Those advantages are uncopyable in a WebView. **Win instead** on four things, in order:

1. **Never lose work** (persistence / detach) — closes the #1 product gap.
2. **Never freeze** (terminal reliability) — closes the #2 gap; your own Appendix A already specs the fixes.
3. **Ship like a real project** (tests, CI, release pipeline, license) — closes the widest gap and earns trust.
4. **Semantic orchestration** (Conductor DAG + LLM relay + cross-agent handoff) — the thing herdr *deliberately refuses to build*, and your defensible moat.

> The single highest-leverage fact: **closing the app currently kills every agent and loses all running work** (`storage.ts:146-147`). For a tool whose purpose is long-running multi-agent work, that is existential.

---

## Part A — Where herdr is better (the gaps)

### A1. Sessions that never die (persistence / detach / remote) — **the #1 product gap**

This is herdr's core promise and Orchaterm's biggest hole.

- **herdr:** `prefix+q` detaches the client while **agents and shells keep running**; `herdr` reattaches from any terminal or **over SSH**. On a full server stop it restores workspace/tab/pane/cwd/layout, replays pane screen history, and **natively resumes agent conversations** (`claude --resume <id>`, `codex resume`, …). Experimental `--handoff` keeps PTYs alive across a server *replacement*. (`docs/.../quick-start.mdx:54-62`, `session-state.mdx:8-107`, `persistence-remote.mdx:38-155`)
- **Orchaterm:** `storage.ts:146-147` — *"PTY output is NOT saved — only tab structure… On restore, fresh PTY sessions are spawned."* `ORCHATERM_ARCHITECTURE.md:391-397` and `ORCHATERM_USER_GUIDE.md:196` — *"Terminal sessions are ephemeral — they reset each time you restart."* There is **no detach, no headless mode, no SSH attach** — it is a Tauri GUI window. The only "detached thread" in the backend is the kill thread (`lib.rs:807`), not multiplexer detach.
- **Implication:** Closing the app (or a crash) kills every agent and discards all running work. This is the gap most likely to make a user abandon the tool.

### A2. Terminal reliability under load (the freezes)

Your existing audit (Appendix A) is the authoritative write-up. Headlines, refreshed against current source:

- **Blocking PTY I/O on the main (UI) thread.** `write_pty`, `resize_pty`, `kill_pty` are synchronous `#[tauri::command]` handlers (`lib.rs:743,764,791`); `write_pty` does `write_all`+`flush` inline (`lib.rs:755-759`). While blocked, all command dispatch is suspended — including kill/resize for *other* tabs. (HIGH)
- **Every output chunk is double-handled on the JS main thread, unbatched, for every tab (including hidden ones).** `term.write(data)` per event (`TerminalTab.tsx:504-512`) **plus** a second `bufferWatcher` listener doing `buffer += chunk` + `clearTimeout`/`setTimeout` per chunk (`bufferWatcher.ts:145-147,161-195`). Hidden tabs keep doing all of it (`TerminalContainer.tsx:1276-1305`). (HIGH — most likely cause of *intermittent* freezes under burst output)
- **Unbounded output channel.** Reader→coalescer is an unbounded `std::sync::mpsc` (`lib.rs:639`); sustained >~3 MB/s → unbounded memory growth + growing latency. (MED)
- **No Unix process-group/session kill and no app-exit hook.** `kill_pty` only kills the direct child (`lib.rs:817`); no `killpg`/`setsid`, no `RunEvent::Exit`/`on_window_event` cleanup (`.run()` at `lib.rs:934`). `disown`ed / daemonized grandchildren survive as orphans. (HIGH as a cross-platform divergence; Windows is fine — see B6.)
- **`bufferWatcher` leak:** closed tabs never call `unwatch`, permanently leaking a `WatchEntry` + Tauri listener + up to 256 KB buffer per closed tab. (MED; HIGH as a defect regardless)

**herdr's contrast:** one dedicated OS thread per PTY outside the runtime (`pty/actor/unix.rs:378-381`); bounded data channel + separate unbounded control channel (`:345-346`); bytes fed **inline** into the in-process emulator with only a coalesced **render signal** crossing threads (`pane.rs:1920-1922`); session-wide SIGHUP→SIGTERM→SIGKILL escalation (`pane.rs:1140-1188`); resize applied on the same thread that reads via a latest-wins atomic (`unix.rs:59-63,702-710`).

### A3. Agent detection (non-cooperative manifests vs sentinel tokens)

- **herdr:** 19 TOML **screen-buffer manifests** (`detect/manifest.rs:239-259`) classify `idle/working/blocked/done` for Claude, Codex, Gemini, Cursor, Copilot, Antigravity, Cline, etc. by reading the bottom-buffer snapshot — **with zero cooperation from the agent**. Rules use `state`/`priority`/`region` + nested `all`/`any`/`not` gates with `contains`/`regex` matchers (`detect/manifest.rs:152-213`; e.g. `claude.toml:7-13`). Manifests are **hot-reloadable** (`~/.config/herdr/agent-detection/<agent>.toml` + `reload-agent-manifests`); source precedence is Bundled→Remote→Override (`manifest.rs:50-72`).
- **Orchaterm:** **cooperative sentinel tokens** — dispatched tasks instruct the agent to print `###ORCHATERM_DONE### … ###ORCHATERM_END###` (`orchestratorEngine.ts:56-81`, `sentinelParser.ts:107-139`). Requires the agent to (a) understand, (b) obey verbatim, (c) not split markers with ANSI — and forces an **echo-suppression arms race** (`bufferWatcher.ts:241-247,386-403`, 500 ms `ignoreUntil` window). You *do* have light non-cooperative detection (`INTERACTIVE_PROMPT_REGEX` for `[y/n]`, `esc to cancel`, `:31-49`) but it surfaces "waiting for input" / auto-answers — it never identifies *which* agent.
- **Implication:** herdr works with 19 agents out-of-the-box with zero prompt engineering. The sentinel breaks the moment an agent paraphrases, echoes the template, or streams ANSI across a marker. The sentinel is still the right call for tasks *you* dispatch (deterministic), but it is fragile for ad-hoc agents the user runs themselves.

### A4. Programmability (socket API / CLI / plugins / agent-skill vs none)

- **herdr:** a layered, deterministic, **LLM-free** programmable surface:
  - Newline-JSON **socket API** (`pane.split/send_text/read`, `agent.wait/prompt`, `events.subscribe`) over Unix socket / Windows named pipe (`docs/.../socket-api.mdx:97-112,600-625`). `agent.wait --until done|blocked` blocks on *semantic detected state*, not process exit, and **pins the pane occupant** so a replacement can't satisfy it (`:114,801-803`).
  - A **CLI** wrapper, an **agent skill** (teaches any coding agent to drive herdr when `HERDR_ENV=1`), and a **plugin system** with `herdr-plugin.toml` declaring `[[build]]/[[actions]]/[[events]]/[[panes]]/[[link_handlers]]`. *"The entire herdr CLI is the plugin API."* (`plugins.mdx:23-30`, `agent-skill.mdx:14-24`, `SKILL.md:125-138`)
  - `HERDR_SOCKET_PATH`/`HERDR_PANE_ID` are injected into every managed process so agents self-drive.
- **Orchaterm:** **no scripting/plugin surface at all.** The only API is the React UI; all orchestration lives in the in-process `orchestratorEngine` singleton. No socket, no CLI, no skill file.
- **Implication:** herdr is a *platform*; Orchaterm is an *app*. Plugins/API turn a tool into an ecosystem.

### A5. Architecture & code discipline

| Dimension | herdr | Orchaterm |
|---|---|---|
| **Module decomposition** | ~25 top-level modules (`app/`, `api/`, `platform/`, `protocol/`, `detect/`, `pty/`, `terminal/`, `ghostty/`, `server/`, `client/`, `cli/`, `config/`, `persist/`, `integration/`, `remote/`, `workspace/`, `input/`, `ui/`) | Backend = **one 936-line `lib.rs`** holding Windows Job-Object FFI, shell detection, 8 commands, 3 thread loops, UTF-8 logic, and app entry. No modules. |
| **State / runtime separation** | Pure-data `AppState` (`state.rs:1403`) with `test_new()` (`:1781`) + `assert_invariants_for_test()` (`:1978`); I/O isolated in `runtime.rs`. | Backend state is a bare `Mutex<HashMap<String,PtySession>>` (`lib.rs:265`). Frontend "state" is `DashboardContext.tsx` (828 lines, 30+ hooks, mixing 7+ domains). |
| **Platform isolation** | `src/platform/{linux,macos,windows,fallback}.rs` ≈ 4,296 lines behind a trait (`platform/mod.rs:1-5`). Core has only small `#[cfg]` arms. | All OS code inlined in `lib.rs` (Job Object `19-81`, shell tables `105-243`, WebView2 setup `915-931`). No `platform/` module. |
| **Error handling / logging** | 373 `tracing!` calls; **`unwrap()` forbidden in production** (rule, verified: 0 in non-test regions of `state.rs`/`actions.rs`). | `eprintln!` (`lib.rs:662`), `println!` (`:927`), `.expect(...)` (`:935`), `.unwrap().Settings().unwrap()` chains (`:924-925`). Mutex poisoning recovered pragmatically but undocumented (`:411-419`). |
| **Wire contract** | Versioned: `PROTOCOL_VERSION = 17` + size caps + explicit version-check errors (`protocol/wire.rs:16-28,921-930`). | Implicit: 8 command fns + `pty-data-{id}` / `pty-exit-{id}` event names built by string formatting. No version, no schema, no migration path. |
| **Frontend (Orchaterm-specific)** | n/a | `Settings.tsx` 2,424 / `TerminalContainer.tsx` 2,031 / `GroupChat.tsx` 1,469 / `PromptVault.tsx` 1,207 / `TerminalTab.tsx` 1,104 / `Sidebar.tsx` 944 lines; only 12 of ~50 components memoized → global re-renders. |

> **Caveat (fairness):** herdr decomposes *modules*, not always *files* — `server/headless.rs` 9,511, `app/actions.rs` 5,699, `pane/terminal.rs` 5,611 lines exist. Its "no god objects" rule is partly aspirational. But the *separation of concerns* (state vs runtime, platform vs core, protocol vs impl) is real and testable; Orchaterm's is not.

### A6. Project maturity (the widest gap)

| Dimension | herdr | Orchaterm |
|---|---|---|
| **Tests** | 2,898 `#[test]`/`#[cfg(test)]` across 153 files + integration `tests/` + `tests/cli/` (13 modules) + fixture corpora + 7 Python maintenance scripts | 15 vitest files (~160 cases) + **7 Rust tests in one UTF-8 module**. **Zero tests on the safety-critical backend** (spawn / kill / shell-detect / clamp-dims). |
| **CI** | **11** GitHub workflows (matrix ci across Ubuntu/macOS/Windows, conventional-commits gate, Windows ConPTY smoke; `preview.yml`; `release.yml`; `nix.yml`; `website.yml`; PR/issue gates) | **None.** No `.github/` directory. |
| **Release / distribution** | Single static binary; linux/macos x86_64+aarch64 (+ win x86_64 preview); Homebrew, mise, Nix flake, `install.sh`/`install.ps1`, GitHub Releases + SHA256 sidecars, stable/preview auto-update channels | `tauri.conf.json bundle.targets="all"` builds locally. **Nothing published, signed, or auto-updated.** |
| **Quality gates** | Pinned toolchain (`rust-toolchain.toml`), `clippy.toml`, `cargo fmt --check`, `-D warnings`, `.githooks/{pre-commit,commit-msg}`, `just check` | `tsconfig strict` + `tsc` only. **No ESLint, Prettier, rustfmt/clippy, pre-commit hooks.** |
| **Docs** | Astro site (herdr.dev), 20+ MDX pages, **JA + zh-CN translations**, versioned docs, 929-line CHANGELOG, CONTRIBUTING, SKILL.md, SPONSORS, AGENTS.md (237 lines) | Rich **internal** docs (Architecture 29 KB / User Guide 25 KB / PLAN 69 KB) but **README.md is the unmodified 8-line Tauri template**, no LICENSE, no CHANGELOG, no public site. |
| **Dependency hygiene** | Vendored portable-pty + libghostty-vt with `*.patches.md` rationale and **machine-checked patch tests** on every CI | `bun.lock` + plain deps; no auditing, no vendoring discipline. |

---

## Part B — Where Orchaterm is better / our real moat

These are things herdr **deliberately does not do**. They are the differentiation to protect and amplify.

1. **LLM-driven semantic orchestration (the Conductor).** A real task **DAG** (`dependsOn[]`), sequential/parallel modes, LLM-driven plan generation, one-task-per-session dispatch, **auto-relay of parent context** into the next task, and **merging of parallel outputs** into a single brief (`orchestratorEngine.ts:264-288,317-345`, `RightPanel.tsx:96-160`). Override primitives: `failTask`/`retryTask`/`forceCompleteTask`/`injectMessage` + timeout auto-fail. **herdr has no planner** — coordination is left to the user/socket caller.
2. **Cross-agent context migration.** `SessionContinuationService` detects `LIMIT_HIT/STALLED`, writes rolling checkpoint summaries to `.orchaterm/checkpoints/`, and injects a resume prompt into a *different* agent tab (Claude→Antigravity) (`sessionContinuationService.ts:114-203`, `SESSION_CONTINUATION_WORKFLOW.md:30-73`). herdr only resumes the *same* agent after a server restart — it cannot migrate context between agents.
3. **Peer-help protocol.** `###ORCHATERM_NEEDS###` + `needsBroker.ts` lets an agent **ask a peer for help mid-task** (`sentinelParser.ts:213-229`). herdr has no equivalent.
4. **Multi-provider LLM layer.** Clean provider abstraction (`src/services/llm/`: Ollama / Anthropic / Gemini / OpenAI-compat). herdr is LLM-free by design (intelligence lives inside agents). You offer a "team lead" that works with whatever model the user prefers, and degrade gracefully to pass-through when offline (`orchestratorEngine.ts:355-358`, `ORCHATERM_ARCHITECTURE.md:259-261`).
5. **GUI accessibility / zero learning curve.** Sidebar + Workspaces/Groups + Chat/Pipeline tabs, point-and-click rename/color/drag-reorder, 22-color theme editor, quick-action bars. herdr demands prefix-key education. For non-tmux-power-users, Orchaterm is friendlier on day one.
6. **Windows process cleanup.** Kill-on-close **Job Object** (`lib.rs:19-81`, assigned `556-557`, `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) — arguably *simpler and more robust* than herdr's enumerate-and-escalate on Windows. Keep as-is.
7. **Frontend terminal hygiene (specific narrow wins).** UTF-8 streaming integrity (`drain_valid_utf8`, `lib.rs:292-330`), input chunking on paste (`ptyUtils.ts:36-52`), debounced double-rAF resize with `safeFit` pre-probe (`TerminalTab.tsx:532-551,57-66`). These are production-grade; the *system around them* is the problem, not these pieces.

---

## Part C — Equal or not worth chasing

- **Not portable / not your fight:** Vendoring Ghostty's VT emulator (you cannot run it in a WebView — xterm.js is correct for a GUI app); becoming a TUI; competing on raw terminal fidelity or in-process throughput. herdr's burst-throughput edge is *architectural* (no IPC, no output queue) and uncopyable here.
- **Tie:** Neither project keeps all files small. herdr tolerates 5k–9k-line files despite its "no god objects" rule; Orchaterm tolerates 2k-line components. The difference is herdr splits *concerns*, Orchaterm does not.
- **Don't chase vendoring portable-pty** for the Windows ConPTY patches unless you actually observe Windows freezes — herdr's two patches are **Windows-only** and will not help Linux/macOS (whose reliability advantages come from herdr's *own* architecture, not the vendoring).

---

## Implementation Plan (prioritized, trackable)

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done. Effort: S/M/L. Each task is independent unless `Depends:` is noted.

### Tier 0 — Stop losing work  *(highest impact; defines the product)*

- [ ] **P0.1 — Persist live PTY sessions across restart (v1).** Even a first version closes ~80% of the pain: on close/crash, save per-session `{cwd, shell, last command(s), scrollback snapshot}`; on restore, respawn the shell in the same cwd and replay scrollback into xterm. **Files:** `src-tauri/src/lib.rs` (capture cwd via the monitor thread before exit), `src/services/storage.ts`, `src/services/sessionContinuationService.ts`. **Effort:** M. *This single item changes the product from "loses your work" to "remembers it."*
- [ ] **P0.2 — App-exit hook that tears down sessions explicitly (also fixes A2 Unix orphans).** Add `RunEvent::ExitRequested` / `on_window_event` in `run()` to iterate live sessions and persist state before quitting. **Files:** `src-tauri/src/lib.rs:895-936`. **Effort:** S. *Depends on:* P0.1's capture path.
- [ ] **P0.3 — Background PTY host + window-as-client (the real detach story).** Move PTY ownership out of the Tauri window process into a **long-lived host service**; the window becomes a client that can detach/reattach. This mirrors herdr's "server-owned runtime, client UI" direction (`AGENTS.md` §runtime/client boundary) and is the only way to get true detach + survive-window-close. **Effort:** L (architectural). *Design spike first; pairs with P0.1 as the incremental path.*
- [ ] **P0.4 — Headless / remote attach (stretch).** Once P0.3 lands, expose the host over a local socket so a window (or a future TUI/SSH client) can attach remotely. **Effort:** L. *Depends on:* P0.3.

### Tier 1 — Kill the freezes  *(your own Appendix A already specs these — execute them)*

Order from Appendix A §5: **P1.1 → P1.3 → P1.4 → P1.5 → P1.2** (these alone eliminate most intermittent freezes) → P1.6 → P1.7 → P1.8.

- [ ] **P1.1 — `bufferWatcher.unwatch(sessionId)` on tab close.** *(Appx A Q1 / 3d)* Call it in `closeTab` (`TerminalContainer.tsx:562-571`) and `removeTerminalSession` (`DashboardContext.tsx:679-682`). ~2 lines/site. **Effort:** S.
- [ ] **P1.2 — Respect `$SHELL` in shell detection.** *(Appx A Q2 / 4a)* Prefer `std::env::var("SHELL")` (if set and exists) before the hardcoded list in `platform_default_shell` (`lib.rs:426-448`) / `get_available_shells` (`lib.rs:125-243`); add `/usr/bin/zsh`, `/usr/bin/bash`, optionally `/opt/homebrew/bin/zsh`. Keep the `-l` login flag (`lib.rs:507-509`). **Effort:** S.
- [ ] **P1.3 — Move `write_pty` off the main-thread command path.** *(Appx A Q3 / 3b)* Per-session writer thread (bounded `mpsc`) mirroring the reader/coalescer pattern (`lib.rs:644-738`); command returns immediately after enqueue. **Effort:** M.
- [ ] **P1.4 — Batch xterm writes per animation frame.** *(Appx A Q4 / 3a)* In the `pty-data` listener (`TerminalTab.tsx:504-512`), accumulate chunks and flush with one `term.write(concat)` inside a `requestAnimationFrame`. **Effort:** S.
- [ ] **P1.5 — Shed/defer work for hidden tabs.** *(Appx A Q5 / 3a)* Skip per-chunk `term.write` for hidden tabs (buffer + flush on show), or at minimum skip the `bufferWatcher` scan path for hidden sessions. **Effort:** S.
- [ ] **P1.6 — Bound the output channel; shed on overflow.** *(Appx A D1 / 3c)* Replace the unbounded `std::sync::mpsc` (`lib.rs:639`) with a bounded channel; on overflow coalesce/drop oldest unflushed chunks (terminal output is lossy-tolerant for display). **Effort:** M.
- [ ] **P1.7 — Unix process-tree kill + exit hook.** *(Appx A D2 / 4b)* `killpg`/session kill with SIGHUP→SIGTERM→SIGKILL escalation in `kill_pty` (`lib.rs:817`) and on session drop; reuse the P0.2 exit hook. **Effort:** M.
- [ ] **P1.8 — Move `resize_pty` (and spawn heavy-lifting) off the main-thread command path.** *(Appx A D3 / 1d,3b)* Deliver resize through the same per-session channel with latest-wins coalescing so the global session Mutex (`lib.rs:773-786`) is no longer held across the resize call. **Effort:** M. *Depends on:* P1.3 (shared per-session actor).

### Tier 2 — Ship like a real project  *(trust & reach; closes the widest gap)*

- [ ] **P2.1 — Add a LICENSE.** Choose AGPL-3.0 (herdr's, copyleft) or MIT/Apache-2.0 (permissive). *Currently nobody can safely fork/contribute.* **Effort:** S.
- [ ] **P2.2 — CI workflow.** `.github/workflows/ci.yml`: `tsc --noEmit` + `vitest run` + `cargo fmt --check` + `cargo clippy -D warnings` + `cargo test`, on push/PR for Windows + Ubuntu + macOS. **Effort:** S.
- [ ] **P2.3 — Backend tests for safety-critical paths.** `#[test]`s for shell detection (incl. `$SHELL` after P1.2), `clamp_dims`, `drain_valid_utf8` edge cases, and process-kill behavior (spawn a sleep child, kill, assert no orphan). **Effort:** M.
- [ ] **P2.4 — Lint/format.** ESLint + Prettier for the frontend; `rustfmt.toml` + `clippy.toml` for the backend; wire into CI (P2.2) and a `.githooks/pre-commit`. **Effort:** S.
- [ ] **P2.5 — Real README + CHANGELOG.** Replace the 8-line Tauri template with a real README (what it is, screenshots, install, quick start) and start a CHANGELOG. **Effort:** S.
- [ ] **P2.6 — Release pipeline.** Tauri bundler in GitHub Actions → signed installers for macOS (notarized) + Windows (codesigned) + Linux; enable Tauri's updater with a published endpoint. **Effort:** L.

### Tier 3 — Architecture hygiene  *(makes Tiers 0–1 safer to land)*

- [ ] **P3.1 — Split `lib.rs` into modules.** `pty/` (sessions, reader/coalescer/writer threads), `commands/`, `shell_detect/`, `platform/{windows,unix}.rs` (move the inline Job-Object FFI and `#[cfg]` shell tables out). *(Appx A D5 / A5)* **Effort:** M.
- [ ] **P3.2 — Separate pure state from runtime.** A testable `AppState` (no PTYs/async) + thin I/O runtime, mirroring herdr's `AppState::test_new()`/`assert_invariants_for_test()`. Unblocks P2.3. **Effort:** M.
- [ ] **P3.3 — Structured logging.** Replace `eprintln!`/`println!`/`.unwrap().Settings().unwrap()` with `tracing`; drop production `unwrap()`s. **Effort:** S.
- [ ] **P3.4 — Versioned Tauri command/event contract.** Add a protocol version + a typed schema (consider `ts-rs` or `specta` to generate TS types from Rust) so the Rust↔TS mapping isn't by convention. **Effort:** M.
- [ ] **P3.5 — Frontend state store + component split.** Extract `DashboardContext.tsx` (828 lines, 7+ domains) into a real store (Zustand) or sliced contexts; split `Settings.tsx` (2,424) / `TerminalContainer.tsx` (2,031); memoize hot components. **Effort:** L.

### Tier 4 — Close feature gaps where it matters for *our* product

- [ ] **P4.1 — Non-cooperative detection as a complement, not a replacement.** Keep the sentinel for tasks *we* dispatch (deterministic), but add herdr-style screen-buffer manifests for ad-hoc agents the user runs — so the Chat feed shows crisp `idle/working/blocked` badges instantly instead of waiting ~10 s for an Ollama summary. Best of both. **Effort:** L.
- [ ] **P4.2 — Expose a real API/plugin surface.** A local socket/CLI so users and agents can script panes (split/send/read/wait). First cut can be thin; turns Orchaterm from an app into a platform. **Effort:** L. *Depends on:* P0.3 (host).
- [ ] **P4.3 — Config file.** TOML/JSON, dotfiles-friendly, live-reloadable, instead of opaque GUI-only `AppSettings`. **Effort:** M.

### Don't bother
- ❌ Vendoring Ghostty VT (not runnable in a WebView).
- ❌ Becoming a TUI / competing on terminal fidelity or in-process throughput.
- ❌ Vendoring portable-pty for Windows ConPTY (only if real Windows freezes appear).

---

## Appendix A — Detailed terminal-reliability analysis & fix table

*(The original terminal-only audit, preserved. All file:line references are to `src-tauri/src/lib.rs` unless noted.)*

### A.1 Where herdr is better (concrete, with file:line)

**1a. The PTY read path never touches a shared runtime or the render path.** herdr runs one dedicated OS thread per PTY, fully outside tokio (`pty/actor/unix.rs:378-381`), a non-blocking `poll(2)` loop (`:417-471`) woken by a self-pipe (`pty/fd.rs:86-104`). Orchaterm already puts the *read* loop on its own thread (`lib.rs:644-668` reader, `677-738` coalescer) — good. The write/resize/spawn/kill commands stay on the main-thread command path (`lib.rs:743-823`), which is the gap.

**1b. PTY output is consumed inline into an in-memory emulator — no output channel, no backpressure deadlock.** `read_once` (`pty/actor/unix.rs:647-663`) calls `(self.on_read)(&buf[..n])` inline. The only thing crossing to the render loop is a coalesced render signal gated by an `AtomicBool` (`pane.rs:1920-1922`). A 100 MB `cat` produces millions of reads and **zero** queued frames. Orchaterm can't copy this directly (it must cross IPC to xterm.js), but the principle — *coalesce to a bounded cadence and shed excess, never queue unbounded* — is portable (fixes P1.4, P1.6).

**1c. Bounded input channel with explicit backpressure + a separate unbounded control channel.** `pty/actor/unix.rs:345-346`: bounded data channel (cap 1024) + unbounded control channel. Producers await a permit (`:115`); a full data queue cannot block handoff/shutdown (proven by test `handoff_control_is_not_blocked_by_full_data_queue`, `:1246-1278`). Orchaterm's input path is fire-and-forget `write_pty` with no backpressure signal.

**1d. Resize is coalesced ("latest wins") and applied on the same thread that reads — race-free.** `SharedPtyControls` atomic (`unix.rs:59-63`), applied on the actor thread (`:702-710`, `fd.rs:220-241`). No mutex between a reader and a resizer. Orchaterm's `resize_pty` holds the **global session Mutex** across the resize call (`lib.rs:773-786`).

**1e. Cleanup walks the whole process session with escalating signals (no orphans).** `pane.rs:1140-1188`: SIGHUP→SIGTERM→SIGKILL with 250 ms grace each, over the *whole session* (PID set built by session enumeration: `/proc` walk on Linux, `proc_listallpids`+`getsid` on macOS, ToolHelp tree on Windows). Orchaterm's `kill_pty` only `child.kill()`s the direct child (`lib.rs:817`); no `killpg`/session kill; no app-exit hook.

**1f. Shell detection respects `$SHELL`; Orchaterm ignores it.** `pane.rs:1206-1237`. Orchaterm's `get_available_shells`/`platform_default_shell` (`lib.rs:125-243,426-448`) never reads `$SHELL`; Unix absolute list is hardcoded `/bin/zsh,/bin/bash,/bin/sh,/bin/dash` (`:141-146`); by-name list only `fish,nu,elvish` (`:162`). `/usr/bin/zsh` (most Linux distros) and Homebrew `/opt/homebrew/bin/zsh` are not detected.

**1g. State is separated from runtime (testability + reliability).** herdr: `TerminalState` pure data (`terminal/state.rs:99-127` — "no channels, no async, no PTY"), `TerminalRuntime`/`PaneRuntime` thin I/O glue. Orchaterm: a single 936-line `lib.rs`.

**1h. Vendored `portable-pty` — Windows reliability patch.** herdr pins `portable-pty = "=0.9.0"` and `[patch.crates-io]`-replaces it (`Cargo.toml:31,46-47`). Two patches, **both Windows-only** (`vendor/portable-pty.patches.md`, machine-checked by `scripts/test_vendor_portable_pty.py:87-112`): force system ConPTY from `kernel32.dll` (avoids a foreign `conpty.dll` on PATH) and `raw_arg()` for `cmd /d /c`. **Unix/macOS advantages are NOT in these patches** — they come from herdr's own architecture (1a–1e) + shell policy (1f).

### A.2 Where we're already equal or better (do NOT touch)

- **UTF-8 streaming integrity.** `drain_valid_utf8` (`lib.rs:292-330`) carries split multibyte tails across reads and flushes ≥4-byte invalid tails. Well-tested (`lib.rs:332-408`). Equal-to or better than herdr's parse path in this narrow respect.
- **Output coalescing exists.** Coalescer (`lib.rs:677-738`) debounces to ≤10 ms / 32 KB before emitting. The issue is the *unbounded feed into it*, not its existence.
- **Input chunking on paste.** `ptyUtils.ts:36-52` splits large writes into 80-char chunks w/ 8 ms delay + surrogate-pair guard, unit-tested. Solid.
- **Windows process-tree cleanup.** Kill-on-close Job Object (`lib.rs:19-81`, assigned `556-557`). Arguably simpler/more robust than herdr's enumeration+escalation on Windows. Keep as-is.
- **Frontend resize handling.** `ResizeObserver` debounced 100 ms + double-rAF (`TerminalTab.tsx:532-551`), `safeFit` pre-probes (`:57-66`), `term.onResize`→`resize_pty` guarded against pixel-noise loops (`:469-474`).
- **`TerminalTab` in-tab listener/dispose hygiene.** Per-tab `pty-data`/`pty-exit` listeners correctly unlistened on unmount incl. an async-resolution race via a `cancelled` flag (`:482,504-509,520-522`); addons disposed before `term.dispose()` (`:624-626`). No leak *inside* a tab. (The leak is `bufferWatcher` — P1.1.)
- **Defensive backend touches.** `clamp_dims` (`lib.rs:276-278`) prevents 0×0 ConPTY crashes; `lock_sessions` recovers from mutex poison (`:411-419`); writer behind its own `Arc<Mutex>` so writes don't block other sessions' resize/kill (`:246-247`).
- **Modern stack.** React 19, xterm 6, Tauri 2.11. Nothing to upgrade for reliability reasons.

### A.3 Root cause analysis: terminal freezing (ranked)

- **[HIGH] 3a — Frontend main-thread saturation.** Synchronous `term.write` per event (`TerminalTab.tsx:504-512`) **plus** a second per-chunk `bufferWatcher` listener (`bufferWatcher.ts:145-147,161-195`), on every chunk, for every tab (hidden tabs included, `TerminalContainer.tsx:1276-1305`). Burst output → main-thread saturation → intermittent freezes that "catch up" when output pauses. Matches the reported symptom precisely.
- **[HIGH] 3b — Blocking `write_pty` on the main-thread command path.** `write_pty` (`lib.rs:743`) does `write_all`+`flush` inline (`:755-759`). The codebase's own comment on sibling `kill_pty` (`:807-811`) states sync commands run on the main (UI) thread. While blocked, all command dispatch is suspended for every tab.
- **[MED] 3c — Unbounded output channel + bounded emit rate.** Reader→coalescer over an unbounded `std::sync::mpsc` (`lib.rs:639`); finite `emit` throughput → unbounded growth under sustained >~3.2 MB/s.
- **[MED] 3d — `bufferWatcher` leak.** Closed tabs never `unwatch` (only call site is `orchestratorEngine.ts:158`); each leaks a `WatchEntry` + Tauri listener + up to 256 KB buffer (`bufferWatcher.ts:56,559-570`). Memory + GC pressure over long sessions.
- **[LOW-MED] 3e — Compounding contributors.** WebGL attach/detach on every visibility change (`TerminalTab.tsx:655-683`, ~16-context Chromium cap → silent DOM-renderer downgrade); unmemoized `terminalSessions` re-rendering all tabs (`DashboardContext.tsx:261`); sync storage commands doing disk I/O on the main thread (`load_store:838, save_store:847, write_file_path:857`).
- **What is NOT the cause (verified absences).** No `Mutex` held across `reader.read()`; `kill_pty` avoids holding the global lock across `wait()` (offloaded, `lib.rs:812-819`); coalescer UTF-8 `carry` is bounded; no `tokio::spawn`/`spawn_blocking` doing blocking I/O.

### A.4 Root cause analysis: cross-platform inconsistency (Linux/macOS)

- **[HIGH] 4a — Shell detection ignores `$SHELL`** (see 1f). The single most defensible explanation for "behaves inconsistently across Linux and macOS." Note: Orchaterm *does* launch Unix shells with `-l` (`lib.rs:507-509`), so it does NOT have the classic "macOS GUI app missing `/opt/homebrew/bin`" bug. The fix is *detection*, not PATH enrichment.
- **[MED] 4b — No process-group/session kill and no app-exit hook on Unix** (see 1e). Best-effort SIGHUP leaves `disown`ed/daemonized grandchildren orphaned.
- **[LOW] 4c — Unguarded Windows error code logged on Unix.** `if code != 109` (`lib.rs:661`) runs on all platforms → spurious `[pty-reader-io-{sid}] read error:` on Linux EIO (5) on every shell exit. Noise, not a bug.
- **[LOW] 4d — macOS ships bash 3.2 at `/bin/bash`; Linux ships 5.x.** Scripts using `mapfile`/`coproc` work on Linux, fail on macOS. Behavioral.
- **[LOW for Linux/macOS] 4e — Unpatched upstream `portable-pty`.** Unix backend of 0.9 is stable; vendoring won't help Linux/macOS (1h).

### A.5 Recommended fixes (prioritized, scope-preserving) → mapped to the Implementation Plan

| Plan ID | Audit ID | Summary |
|---|---|---|
| P1.1 | Q1 / 3d | `bufferWatcher.unwatch(sessionId)` in `closeTab` + `removeTerminalSession` |
| P1.2 | Q2 / 4a | Respect `$SHELL`; add `/usr/bin/{zsh,bash}` |
| P1.3 | Q3 / 3b | Per-session writer thread; `write_pty` returns after enqueue |
| P1.4 | Q4 / 3a | Batch xterm writes per `requestAnimationFrame` |
| P1.5 | Q5 / 3a | Shed/defer work for hidden tabs |
| P1.6 | D1 / 3c | Bound the output channel; shed on overflow |
| P1.7 | D2 / 4b | Unix `killpg` + exit hook |
| P1.8 | D3 / 1d,3b | Move `resize_pty`/spawn off the main-thread path |
| P3.1 | D5 / 1g | Split `lib.rs` into modules |
| (D4) | 1h | Vendor portable-pty for system ConPTY — **only if Windows freezes reported** |

**Suggested execution order:** P1.1 → P1.3 → P1.4 → P1.5 → P1.2 → P1.6 → P1.7 → P1.8 → P3.1 → (D4 only if needed).

---

## Appendix B — Evidence index (file:line)

**Orchaterm** (`src-tauri/src/lib.rs` unless noted)
- Sync command handlers: `spawn_pty:465`, `write_pty:743`, `resize_pty:764`, `kill_pty:791`; main-thread comment `807-811`. Blocking write `755-759`. Reader `644-668`. Coalescer `677-738`. Unbounded channel `639`. Monitor `594-631`.
- Resize holds global mutex `773-786`. Direct-child-only kill `817`. No exit hook: `.run:934`, `.setup:914-933`. Windows Job Object `19-81`, `556-557`. UTF-8 drain `292-330` + tests `332-408`. Mutex-poison recovery `411-419`. `clamp_dims` `276-278`. Storage commands `838,847,857`. Shell detection `125-243,426-448`; `-l` flag `507-509`. `eprintln!`/`println!`/`unwrap()` `662,924-927,935`.
- Frontend: `TerminalTab.tsx:504-512` (listener+write), `532-551` (resize), `57-66` (safeFit), `469-474` (noise guard), `655-683` (WebGL), `624-626` (dispose); `TerminalContainer.tsx:1276-1305` (all tabs mounted), `562-571` (closeTab); `bufferWatcher.ts:145-147` (2nd listener), `161-195` (per-chunk onData), `559-570` (unwatch), `241-247,386-403` (echo suppression), `31-49` (INTERACTIVE_PROMPT_REGEX); `DashboardContext.tsx:679-682` (removeTerminalSession), `261` (terminalSessions); `ptyUtils.ts:36-52` (paste chunking).
- Orchestration: `orchestratorEngine.ts:56-81` (buildAgentProtocol), `264-288` (dispatcher), `317-345` (relay/merge), `355-358` (pass-through fallback), `389-410` (auto-answer), `446-462` (onSentinelReceived), `215-235` (forceCompleteTask), `568` (default Ollama `llama3.2`); `sentinelParser.ts:107-139,213-229`; `sessionContinuationService.ts:114-203`; `storage.ts:24-35,146-147`.
- Frontend sizes: `Settings.tsx` 2424, `TerminalContainer.tsx` 2031, `GroupChat.tsx` 1469, `PromptVault.tsx` 1207, `TerminalTab.tsx` 1104, `Sidebar.tsx` 944, `DashboardContext.tsx` 828.
- Absent: `.github/`, `LICENSE`, `CONTRIBUTING.md`, `CHANGELOG.md`, ESLint/Prettier/rustfmt/clippy config, pre-commit hooks.

**herdr** (`src/...` unless noted)
- Vendored Ghostty VT: `vendor/libghostty-vt/` (Zig, commit `c5a21edfc`); `vendor/libghostty-vt.vendor.json`; C ABI `vendor/libghostty-vt/include/ghostty.h`; one patch `vendor/patches/libghostty-vt/0001-default-grapheme-cluster-mode.patch`. FFI: `src/ghostty/mod.rs:676` (`ghostty_terminal_vt_write`); bridge `src/pane/terminal.rs:1207`.
- PTY threading: dedicated thread `pty/actor/unix.rs:378-381`; poll loop `417-471`; `read_once` `647-663`; bounded data channel cap 1024 `:19,345`; unbounded control `:346`; reserve-await `:115`; non-blocking FDs `pty/fd.rs:30-39`; wake pipe `:86-104`; resize `:220-241`; `SharedPtyControls` `unix.rs:59-63`, applied `:702-710`.
- Render signal (no output queue): `pane.rs:1760-1762,1920-1922`. Cleanup `pane.rs:1140-1188` (SIGHUP/TERM/KILL), `1101-1138` (liveness), `1877-1900` (spawn_blocking wait).
- Detection: `detect/mod.rs:11-20,43-100`; `detect/manifest.rs:50-72,152-213,239-259,264-297`; `detect/manifests/claude.toml:7-13,42-54,66-77`, `codex.toml:14-20,36-45`.
- Protocol/programming: `protocol/wire.rs:16,20-28,921-930`; `docs/.../socket-api.mdx:97-112,114,255-258,369-441,478-511,600-625,801-803,855-867`; `plugins.mdx:23-30`; `agent-skill.mdx:14-24`; `SKILL.md:125-138`.
- Persistence/UX: `docs/.../quick-start.mdx:54-62`; `session-state.mdx:8-107`; `persistence-remote.mdx:38-155`; `keyboard.mdx:33-100`; `configuration.mdx`; `agents.mdx:38-93`.
- Maturity: `Cargo.toml` (=0.9.0 pin, `[patch.crates-io]`); `rust-toolchain.toml` (1.96.1); `clippy.toml`; `justfile`; `.githooks/{pre-commit,commit-msg}`; `flake.nix`/`nix/`; `.github/workflows/` (11 workflows); `scripts/` (22 files, 7 `test_*.py`); `vendor/portable-pty.patches.md`, `vendor/libghostty-vt.patches.md`; `CHANGELOG.md` (929 lines), `CONTRIBUTING.md` (126), `AGENTS.md` (237), `SKILL.md` (195), `SPONSORS.md` (63), `LICENSE` (AGPL); `website/src/content/docs/` (20 MDX + `ja/` + `zh-cn/`). Tests: 2,898 `#[test]`/`#[cfg(test)]` across 153 files; `tests/` + `tests/cli/` (13 modules).
