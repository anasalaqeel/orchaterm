# Known gap: coding agents can't drive interactive CLI wizards

Surfaced 2026-09-06 while working on the Soknah project, trying to run
`eas credentials -p ios` (Expo/EAS CLI) through Claude Code. Documenting
here because Orchaterm's own architecture is positioned to close it.

## The problem

Some CLI tools ship arrow-key/inquirer-style interactive wizards for
operations that mint or manage security-sensitive material — signing
certs, push notification keys, provisioning profiles, OAuth logins. A
coding agent (Claude Code, Aider, Cursor, etc.) cannot drive these today.

Two independent causes stack together:

1. **No real TTY.** Agent tool calls run subprocesses with stdin attached
   to a null device (or a piped, non-interactive stream) rather than a
   real pseudoterminal. Inquirer-style prompts, raw-mode key capture, and
   ANSI cursor-menu rendering all depend on a genuine TTY. Without one,
   the process either reads EOF immediately or hangs.
2. **Deliberate refusal, independent of TTY.** Some tools explicitly
   check for a non-interactive context and refuse outright rather than
   degrading gracefully. Example verified in `eas-cli` source
   (`packages/eas-cli/src/credentials/ios/actions/CreatePushKey.ts`):
   ```ts
   if (ctx.nonInteractive) {
     throw new Error(`A new push key cannot be created in non-interactive mode.`);
   }
   ```
   This is intentional — Apple push-key creation talks live to Apple's
   API and the tool authors decided that step should never run unattended
   (CI, scripts, agents). It's the same family as `git rebase -i`,
   `npm login`, `gh auth login`, cloud-CLI `configure` wizards: tools that
   refuse to run headless on purpose.

Cause #1 is a plumbing gap. Cause #2 is a deliberate boundary that no
amount of plumbing should try to route around — the fix there is a human
in the loop, not automation.

## Why Orchaterm already has half the fix

Checked `src-tauri/src/lib.rs` (2026-09-06 state): Orchaterm's terminal
panes are backed by real `portable-pty` sessions, not piped subprocess
I/O. `write_pty(session_id, data)` (`lib.rs:851`) writes real bytes into
a real PTY. A process running inside an Orchaterm pane sees a genuine
terminal — `eas credentials -p ios` would render its interactive menu
correctly there, because cause #1 (no TTY) simply doesn't apply inside
an Orchaterm session.

This isn't a coincidence — it's exactly what "Sentinel Protocol & State
Detection" (buffer observation) and the ambient orchestrator (deciding
what's happening in a pane and coordinating across panes) already need:
real PTYs, programmatic writes, and buffer reads.

## What's missing

Today, `write_pty` and buffer state are only reachable from Orchaterm's
own frontend, driven by its own internal ambient orchestrator (the
Ollama/LM Studio/Claude/Gemini configured in Settings). An external agent
— a separate Claude Code session, Aider, etc. — has no way to reach into
a running Orchaterm instance's PTY sessions. There is no MCP server or
equivalent external-facing API surface exposed by Orchaterm (checked:
no `mcp` references anywhere in `src-tauri/src` or `src`).

## Proposed shape (not yet built)

Expose an MCP server from Orchaterm with, at minimum:

- `open_terminal(cwd, shell?)` → session_id
- `write_pty(session_id, data)` → already exists internally, needs
  external exposure
- `read_buffer(session_id, lines?)` → rendered pane content, so an
  external agent can see what an interactive prompt is currently showing

With that, an external coding agent could:
1. Open a pane, run the interactive command.
2. Read the rendered buffer to see the current prompt/menu state.
3. Send keystrokes (arrow keys, enter, typed text) to navigate it.

This closes cause #1 for any tool whose only obstacle is TTY absence —
which is most inquirer-style CLIs, most of the time.

## What it should NOT try to close

Cause #2 stays a human step, by design. The right integration pattern
for a step like Apple push-key creation is not "let the agent click
through it autonomously" — it's: the agent drives everything up to the
sensitive confirmation, surfaces the live pane to the human, and the
human performs that one keypress/decision themselves. This matches
Orchaterm's stated philosophy (ambient coordination and relay, not full
autonomous control) better than trying to fully script past a boundary
that was put there on purpose.

## Concrete trigger case

- Project: Soknah (`C:\Users\anasa\Desktop\soknah`)
- Command: `eas credentials -p ios` (also applies to `-p android`)
- Goal: set up APNs push key for production push notifications
- Blocked because: no TTY in Claude Code's sandboxed Bash/PowerShell
  tool execution — confirmed via `eas-cli` source that the base
  `eas credentials` command context is hardcoded `nonInteractive: false`
  (always attempts interactive), so the actual blocker is TTY absence,
  not a flag-gated refusal, for this specific command.
