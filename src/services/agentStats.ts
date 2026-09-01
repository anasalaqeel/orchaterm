/**
 * agentStats.ts
 *
 * Persistent per-terminal reputation record. The engine reports an event every
 * time a task dispatched to a session completes (via sentinel or soft
 * completion), fails, or times out, and every verify-command result. Stats
 * survive restarts (localStorage) so routing decisions and the UI trust score
 * reflect the agent's whole history in this workspace, not just this run.
 */

const STORAGE_KEY = 'orchaterm:agent-stats';

export type AgentStatEvent =
  'sentinel-done' | 'soft-done' | 'failed' | 'timed-out' | 'verify-passed' | 'verify-failed';

export interface AgentStats {
  /** Session title at the time of the last event — for display. */
  title: string;
  sentinelDone: number;
  softDone: number;
  failed: number;
  timedOut: number;
  verifyPassed: number;
  verifyFailed: number;
  lastEventAt: number;
}

type StatsMap = Record<string, AgentStats>; // key: `${workspaceId}:${sessionId}`

function load(): StatsMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as StatsMap) : {};
  } catch {
    return {};
  }
}

function persist(map: StatsMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* storage full — stats are advisory, never worth crashing a run over */
  }
}

export function recordAgentEvent(
  workspaceId: string,
  sessionId: string,
  title: string,
  event: AgentStatEvent
): void {
  if (!sessionId) return;
  const key = `${workspaceId}:${sessionId}`;
  const map = load();
  const stats: AgentStats = map[key] ?? {
    title,
    sentinelDone: 0,
    softDone: 0,
    failed: 0,
    timedOut: 0,
    verifyPassed: 0,
    verifyFailed: 0,
    lastEventAt: 0,
  };
  stats.title = title;
  stats.lastEventAt = Date.now();
  switch (event) {
    case 'sentinel-done':
      stats.sentinelDone++;
      break;
    case 'soft-done':
      stats.softDone++;
      break;
    case 'failed':
      stats.failed++;
      break;
    case 'timed-out':
      stats.timedOut++;
      break;
    case 'verify-passed':
      stats.verifyPassed++;
      break;
    case 'verify-failed':
      stats.verifyFailed++;
      break;
  }
  map[key] = stats;
  persist(map);
}

export function getAgentStats(workspaceId: string, sessionId: string): AgentStats | null {
  return load()[`${workspaceId}:${sessionId}`] ?? null;
}

/**
 * Trust score 0–100: completed-and-verified work weighted highest, plain
 * completions next, failures subtract. New agents (no history) score null so
 * the UI can show "new" instead of a misleading number.
 */
export function trustScore(stats: AgentStats): number | null {
  const completions = stats.sentinelDone + stats.softDone;
  const attempts = completions + stats.failed + stats.timedOut;
  if (attempts === 0) return null;
  const good = stats.sentinelDone * 1.0 + stats.softDone * 0.8 + stats.verifyPassed * 0.5;
  const bad = (stats.failed + stats.timedOut) * 1.0 + stats.verifyFailed * 0.5;
  const score = Math.round((good / (good + bad)) * 100);
  return Math.max(0, Math.min(100, score));
}
