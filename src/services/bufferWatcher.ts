/**
 * bufferWatcher.ts
 *
 * Subscribes to `pty-data-{sessionId}` Tauri events for any number of
 * terminal sessions simultaneously. Accumulates raw output per session and
 * scans for either a task completion sentinel or a plan-generation JSON block,
 * depending on the mode the session is in.
 *
 * Modes per session:
 *   'sentinel' — watches for ###ORCHATERM_DONE### / ###ORCHATERM_END###
 *   'plan'     — watches for ###ORCHATERM_PLAN_START### / ###ORCHATERM_PLAN_END###
 *   'idle'     — listening and accumulating but not triggering callbacks
 *
 * Each session can only be in one mode at a time. Switching modes clears the
 * buffer for that session.
 */

import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { OrchestratorTaskOutput, SessionBuffer, BufferWatchMode } from '../types';
import { parseSentinel, parsePlanBlock, validatePlanJSON, parseNeedsBlock, stripAnsiCodes } from './sentinelParser';

// ── Shell "back-to-prompt" detection regex ────────────────────────────────────
// Fires after 2s idle when a terminal session returns to a shell prompt.
// Covers bash ($), zsh/tcsh (%), zsh-arrow (❯), root (#), cmd/PowerShell (>).
// Kept in sync with PROMPT_PATTERNS in utils/interruptPolicy.ts.
// Only fires in 'idle' / 'summary' modes so conductor-managed sessions are skipped.
const SHELL_PROMPT_REGEX = /[$%#>❯]\s*$/;

// ── Interactive prompt detection regex ─────────────────────────────────────────
// Compiled once at module load — used by checkInteractivePrompt on every idle tick.
const INTERACTIVE_PROMPT_REGEX = new RegExp([
  // y/n bracket markers — any casing
  String.raw`\[y\/n\]|\(y\/n\)|\[Y\/n\]|\(Y\/n\)|\[n\/Y\]|\(n\/Y\)`,
  // Claude Code TUI navigation footer — always present for selection prompts
  String.raw`↑\s*\/\s*↓`,
  // "esc to cancel" footer (appears in all Claude Code interactive dialogs)
  String.raw`esc\s+to\s+cancel`,
  // Numbered option with leading cursor marker: "> 1." or "• 1."
  String.raw`^[>•]\s*\d+\.`,
  // Numbered option list: standalone "1." / "2." lines (option menus)
  String.raw`^\s*\d+\.\s+\S`,
  // Claude Code permission header
  String.raw`Requesting permission for:`,
  // Generic proceed / confirm / allow / deny patterns
  String.raw`Do you want|Press Enter to|Proceed\?|Are you sure|Overwrite\?|Allow\?|Deny\?`,
  String.raw`Select an option|Type a number|Choose an option`,
  // Bare question at end of a line (agent asking something directly)
  String.raw`\?\s*$`,
].join('|'), 'im');

// ── Buffer bounds ───────────────────────────────────────────────────────────────
// Cap retained per-session output so a long-running agent (e.g. Claude Code
// emitting megabytes of ANSI) can't grow an unbounded JS string (memory) and so
// the marker scans below stay cheap regardless of total output (CPU). Detection
// always works on the most-recent tail, so trimming older output is safe.
const MAX_BUFFER_CHARS    = 256 * 1024;
const NEEDS_SCAN_TAIL     =   8 * 1024; // runs on EVERY chunk — keep small
const SENTINEL_SCAN_TAIL  =  32 * 1024;
const PLAN_SCAN_TAIL      =  96 * 1024; // plan JSON arrays can be large

// ── Internal entry ─────────────────────────────────────────────────────────────

interface WatchEntry {
  buffer: SessionBuffer;
  unlisten: UnlistenFn;
  onSentinel?: (output: OrchestratorTaskOutput) => void;
  onPlan?: (rawJson: string) => void;
  onPlanError?: (err: string) => void;
  onNeedsRequest?: (request: import('../types').AgentNeedsRequest) => void;
  onInteractivePrompt?: (promptText: string) => void;
  /** Fires once per 10 s when the terminal returns to a shell prompt (non-conductor sessions). */
  onIdleShell?: () => void;
  _lastIdleShellAt?: number;
  idleTimer?: ReturnType<typeof setTimeout>;
  /**
   * Epoch ms after which plan/sentinel detection should actually fire.
   * While Date.now() < ignoreUntil, incoming data is wiped and not checked.
   * This lets the PTY echo of the sent prompt clear before we start scanning.
   */
  ignoreUntil?: number;
  // Summary mode — supports multiple concurrent subscribers
  summarySubscribers: Array<(chunk: string) => void>;
  summaryDebounceTimer?: ReturnType<typeof setTimeout>;
  /** Buffer length at the last debounce fire — we only send the new delta. */
  summaryLastLength?: number;
}

// ── PTY event payload shape emitted by Rust ────────────────────────────────────
interface PtyPayload {
  session_id: string;
  data: string;
}

// ── BufferWatcher ──────────────────────────────────────────────────────────────

class BufferWatcher {
  private entries = new Map<string, WatchEntry>();

  /**
   * In-flight `listen()` promises. Guards against a TOCTOU race where two
   * concurrent callers both see `entries.get(sessionId)` as undefined before
   * either resolves the `await listen(...)`, which would register two Tauri
   * event listeners for the same session.
   */
  private pending = new Map<string, Promise<WatchEntry>>();

  // ── Internal: get or create a listening entry ──────────────────────────

  private async ensureListening(sessionId: string): Promise<WatchEntry> {
    const existing = this.entries.get(sessionId);
    if (existing) return existing;

    // A concurrent caller is already registering a listener — reuse its promise.
    const inFlight = this.pending.get(sessionId);
    if (inFlight) return inFlight;

    const promise = (async () => {
      const buffer: SessionBuffer = {
        sessionId,
        buffer: '',
        lastActivity: Date.now(),
        mode: 'idle',
      };

      const unlisten = await listen<PtyPayload>(`pty-data-${sessionId}`, (event) => {
        this.onData(sessionId, event.payload.data);
      });

      const entry: WatchEntry = { buffer, unlisten, summarySubscribers: [] };
      this.entries.set(sessionId, entry);
      this.pending.delete(sessionId);
      return entry;
    })();

    this.pending.set(sessionId, promise);
    return promise;
  }

  // ── Internal: handle incoming pty-data chunk ───────────────────────────────

  private onData(sessionId: string, chunk: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;

    entry.buffer.buffer += chunk;
    // Trim to the cap, keeping the most-recent slice. Adjust the summary delta
    // marker by the same amount so its length math stays correct.
    if (entry.buffer.buffer.length > MAX_BUFFER_CHARS) {
      const removed = entry.buffer.buffer.length - MAX_BUFFER_CHARS;
      entry.buffer.buffer = entry.buffer.buffer.slice(removed);
      if (entry.summaryLastLength !== undefined) {
        entry.summaryLastLength = Math.max(0, entry.summaryLastLength - removed);
      }
    }
    entry.buffer.lastActivity = Date.now();

    // NEEDS detection runs regardless of mode — agents can request help at any time
    if (entry.onNeedsRequest) {
      this.checkNeeds(entry);
    }

    switch (entry.buffer.mode) {
      case 'sentinel': this.checkSentinel(entry); break;
      case 'plan':     this.checkPlan(entry); break;
      case 'summary':  this.checkSummary(entry); break;
      case 'idle': break;
    }

    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      this.checkInteractivePrompt(entry);
      this.checkIdleShell(entry);
    }, 2000);
  }

  // ── Internal: interactive prompt check ──────────────────────────────────────

  private checkInteractivePrompt(entry: WatchEntry): void {
    if (entry.buffer.mode !== 'sentinel') return;
    if (!entry.onInteractivePrompt) return;

    // Time-based cooldown: allow retry every 6s so a failed/UNKNOWN answer can be retried
    const now = Date.now();
    const lastFired: number = (entry as any)._lastPromptFiredAt ?? 0;
    if (now - lastFired < 6000) return;

    const tail = stripAnsiCodes(entry.buffer.buffer.slice(-3000));

    if (INTERACTIVE_PROMPT_REGEX.test(tail)) {
      (entry as any)._lastPromptFiredAt = now;
      entry.onInteractivePrompt(tail.trim());
    }
  }

  // ── Internal: idle shell-prompt check ─────────────────────────────────────
  // Fires onIdleShell when the terminal returns to a shell prompt after being
  // idle for 2 s. Only active in 'idle' or 'summary' modes — conductor-managed
  // sessions (sentinel / plan) are intentionally excluded.

  private checkIdleShell(entry: WatchEntry): void {
    if (!entry.onIdleShell) return;
    if (entry.buffer.mode === 'sentinel' || entry.buffer.mode === 'plan') return;

    const now = Date.now();
    const lastFired = entry._lastIdleShellAt ?? 0;
    if (now - lastFired < 10_000) return; // 10 s cooldown per session

    const tail = stripAnsiCodes(entry.buffer.buffer.slice(-600));
    if (!SHELL_PROMPT_REGEX.test(tail)) return;

    entry._lastIdleShellAt = now;
    entry.onIdleShell();
  }

  // ── Internal: sentinel check ───────────────────────────────────────────────

  private checkSentinel(entry: WatchEntry): void {
    // Echo-suppress window: discard incoming data until the delay has elapsed.
    // The dispatch prompt (~2000 chars) echoes back from the PTY after write.
    // Without suppression the echo's sentinel template (with placeholder summary)
    // can trigger a false positive, marking the task done in ~1-2 s.
    if (entry.ignoreUntil !== undefined) {
      if (Date.now() < entry.ignoreUntil) {
        entry.buffer.buffer = '';
        return;
      }
      entry.ignoreUntil = undefined;
    }

    const result = parseSentinel(entry.buffer.buffer.slice(-SENTINEL_SCAN_TAIL));
    if (!result) return;

    // Snapshot callback and clear before calling to avoid re-entrancy issues
    const cb = entry.onSentinel;
    entry.onSentinel = undefined;
    entry.buffer.mode = 'idle';
    entry.buffer.buffer = '';

    if (cb) cb(result);
  }

  // ── Internal: plan JSON check ──────────────────────────────────────────────

  private checkPlan(entry: WatchEntry): void {
    // Echo-suppress window: wipe data until the delay has elapsed.
    if (entry.ignoreUntil !== undefined) {
      if (Date.now() < entry.ignoreUntil) {
        // Still suppressing — discard echo so markers in the prompt body
        // can never create a false-positive match.
        entry.buffer.buffer = '';
        return;
      }
      // Suppress window expired. Every chunk during the window was already
      // wiped, so the buffer holds only the *current* incoming chunk — which
      // is the first real response data from the agent (not echo residue).
      // Clear the flag and fall through so this chunk is scanned immediately;
      // the old "final wipe + return" was silently discarding the agent's
      // first response chunk (often the one containing PLAN_START).
      entry.ignoreUntil = undefined;
    }

    const rawJson = parsePlanBlock(entry.buffer.buffer.slice(-PLAN_SCAN_TAIL));
    if (rawJson === null) return;

    const onPlan  = entry.onPlan;
    const onError = entry.onPlanError;
    entry.onPlan      = undefined;
    entry.onPlanError = undefined;
    entry.buffer.mode = 'idle';
    entry.buffer.buffer = '';

    try {
      validatePlanJSON(rawJson); // throws on invalid
      if (onPlan) onPlan(rawJson);
    } catch (err: any) {
      if (onError) onError(err?.message ?? String(err));
    }
  }

  // ── Internal: summary check ────────────────────────────────────────────────

  private checkSummary(entry: WatchEntry): void {
    if (entry.summarySubscribers.length === 0) return;

    // Tuned to limit LLM call volume on summary subscribers (live feed,
    // auto-relay, continuation detection): coalesce more output per call.
    const MIN_NEW_CHARS = 120;
    const DEBOUNCE_MS   = 1200;

    const currentLength = entry.buffer.buffer.length;
    const lastLength    = entry.summaryLastLength ?? 0;
    const newChars      = currentLength - lastLength;

    if (newChars < MIN_NEW_CHARS) return;

    // Debounce: clear pending timer and set a new one
    if (entry.summaryDebounceTimer) clearTimeout(entry.summaryDebounceTimer);
    entry.summaryDebounceTimer = setTimeout(() => {
      if (entry.summarySubscribers.length === 0) return;
      const newContent = entry.buffer.buffer.slice(lastLength);
      entry.summaryLastLength = entry.buffer.buffer.length;
      // Call all subscribers with the same delta
      for (const cb of entry.summarySubscribers) cb(newContent);
    }, DEBOUNCE_MS);
  }

  // ── Internal: needs check ──────────────────────────────────────────────────

  private checkNeeds(entry: WatchEntry): void {
    const request = parseNeedsBlock(entry.buffer.buffer.slice(-NEEDS_SCAN_TAIL));
    if (!request) return;

    // Avoid re-firing for the same block — deduplicate by the ask field.
    if ((entry as any)._lastNeedsAsk === request.ask) return;
    (entry as any)._lastNeedsAsk = request.ask;

    const cb = entry.onNeedsRequest;
    if (cb) cb(request);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Switch a session into sentinel-detection mode. Any previous mode and buffer
   * is cleared. The callback fires once when the sentinel is detected.
   *
   * @param echoSuppressMs - milliseconds to discard incoming data before starting
   *   detection. Covers PTY echo of the dispatch prompt (~2000 chars, ~200 ms to
   *   send). Default 500 ms. Set 0 to disable.
   */
  async watchForSentinel(
    sessionId: string,
    onSentinel: (output: OrchestratorTaskOutput) => void,
    onInteractivePrompt?: (text: string) => void,
    echoSuppressMs = 500,
  ): Promise<void> {
    const entry = await this.ensureListening(sessionId);
    entry.buffer.buffer = '';
    entry.buffer.mode = 'sentinel';
    entry.onSentinel = onSentinel;
    entry.onInteractivePrompt = onInteractivePrompt;
    entry.onPlan = undefined;
    entry.onPlanError = undefined;
    entry.ignoreUntil = echoSuppressMs > 0 ? Date.now() + echoSuppressMs : undefined;
  }

  /**
   * Switch a session into plan-detection mode. Any previous mode and buffer
   * is cleared. onPlan fires with the raw JSON string when complete.
   * onPlanError fires if the JSON is malformed.
   *
   * @param echoSuppressMs - milliseconds to discard incoming data before
   *   starting real detection (default 400). Covers PTY echo latency (~200 ms
   *   with chunked writes) while expiring well before Claude CLI starts
   *   streaming its response (typically > 500 ms after receiving the prompt).
   *   1500 ms was too long: fast agents (Claude CLI) start streaming within
   *   the old window, causing PLAN_START chunks to be wiped before detection.
   */
  async watchForPlan(
    sessionId: string,
    onPlan: (rawJson: string) => void,
    onPlanError: (err: string) => void,
    echoSuppressMs = 400,
  ): Promise<void> {
    const entry = await this.ensureListening(sessionId);
    entry.buffer.buffer = '';
    entry.buffer.mode = 'plan';
    entry.onPlan = onPlan;
    entry.onPlanError = onPlanError;
    entry.onSentinel = undefined;
    entry.ignoreUntil = echoSuppressMs > 0 ? Date.now() + echoSuppressMs : undefined;
  }

  /**
   * Switch a session into summary mode and add a subscriber. Fires onChunk with
   * debounced terminal output deltas (min 60 new chars, 800 ms debounce). Does
   * NOT clear the existing buffer. Multiple subscribers may watch the same session.
   *
   * Returns an unsubscribe function. Call it to remove this specific subscriber.
   * When the last subscriber is removed, the session returns to idle.
   */
  async watchForSummary(
    sessionId: string,
    onChunk: (chunk: string) => void,
  ): Promise<() => void> {
    const entry = await this.ensureListening(sessionId);
    entry.buffer.mode = 'summary';
    entry.onSentinel  = undefined;
    entry.onPlan      = undefined;
    entry.onPlanError = undefined;
    if (!entry.summarySubscribers.includes(onChunk)) {
      entry.summarySubscribers.push(onChunk);
    }
    // Start from current buffer length so only new content fires
    entry.summaryLastLength = entry.summaryLastLength ?? entry.buffer.buffer.length;

    // Return an unsubscribe function for this specific subscriber
    return () => {
      entry.summarySubscribers = entry.summarySubscribers.filter(cb => cb !== onChunk);
      if (entry.summarySubscribers.length === 0) {
        if (entry.summaryDebounceTimer) clearTimeout(entry.summaryDebounceTimer);
        entry.buffer.mode = 'idle';
      }
    };
  }

  /**
   * Stop summary mode for a session, removing ALL subscribers and returning to idle.
   * Clears any pending debounce timer.
   */
  clearSummary(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    if (entry.summaryDebounceTimer) clearTimeout(entry.summaryDebounceTimer);
    entry.summarySubscribers   = [];
    entry.summaryDebounceTimer = undefined;
    entry.summaryLastLength    = undefined;
    if (entry.buffer.mode === 'summary') entry.buffer.mode = 'idle';
  }

  /**
   * Register a callback that fires when a non-conductor terminal session returns
   * to a shell prompt after being idle for 2 s (10 s cooldown per session).
   * Returns an unsubscribe function.
   *
   * Skipped automatically for sessions in sentinel / plan mode so Conductor-
   * managed tasks do not generate spurious "done" notifications.
   */
  async watchForIdle(
    sessionId: string,
    onIdle: () => void,
  ): Promise<() => void> {
    const entry = await this.ensureListening(sessionId);
    entry.onIdleShell = onIdle;
    entry._lastIdleShellAt = undefined; // reset cooldown on (re-)subscribe
    return () => {
      if (entry.onIdleShell === onIdle) {
        entry.onIdleShell = undefined;
      }
    };
  }

  /**
   * Register a callback for NEEDS block detection on a session.
   * Can be called alongside any other watch mode — NEEDS runs independently.
   * Returns an unsubscribe function.
   */
  async watchForNeeds(
    sessionId: string,
    onNeedsRequest: (request: import('../types').AgentNeedsRequest) => void,
  ): Promise<() => void> {
    const entry = await this.ensureListening(sessionId);
    entry.onNeedsRequest = onNeedsRequest;
    (entry as any)._lastNeedsAsk = undefined; // reset dedup state
    return () => {
      entry.onNeedsRequest = undefined;
    };
  }

  /**
   * Start listening and accumulating buffer for a session.
   * Does not register any callbacks, just keeps the buffer active.
   */
  async registerSession(sessionId: string): Promise<void> {
    await this.ensureListening(sessionId);
  }

  /**
   * Stop all callbacks for a session and reset to idle mode.
   * Buffer is cleared. The Tauri event listener stays active so the watcher
   * can be reused for the next task on the same session without re-subscribing.
   */
  clearBuffer(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.buffer.buffer = '';
    entry.buffer.mode = 'idle';
    entry.onSentinel = undefined;
    entry.onPlan = undefined;
    entry.onPlanError = undefined;
    entry.ignoreUntil = undefined;
  }

  /**
   * Fully stop watching a session. Removes the Tauri event listener.
   * Call when a terminal session is closed.
   */
  unwatch(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.unlisten();
    this.entries.delete(sessionId);
    // Also remove any in-flight pending promise for this session so a future
    // ensureListening() call starts fresh.
    this.pending.delete(sessionId);
  }

  /**
   * Returns the current raw buffer content for a session (for live display).
   */
  getBuffer(sessionId: string): string {
    return this.entries.get(sessionId)?.buffer.buffer ?? '';
  }

  /**
   * Returns the current watch mode for a session.
   */
  getMode(sessionId: string): BufferWatchMode {
    return this.entries.get(sessionId)?.buffer.mode ?? 'idle';
  }

  /**
   * Returns all currently watched session IDs.
   */
  getWatchedSessions(): string[] {
    return Array.from(this.entries.keys());
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────
// One watcher instance shared across the whole app. This ensures only one
// Tauri event listener per session exists at any time.

export const bufferWatcher = new BufferWatcher();
