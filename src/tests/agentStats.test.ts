import { describe, it, expect, beforeEach } from 'vitest';
import { recordAgentEvent, getAgentStats, trustScore, AgentStats } from '../services/agentStats';

const W = 'ws-test';

function stats(over: Partial<AgentStats>): AgentStats {
  return {
    title: 'agent-1',
    sentinelDone: 0,
    softDone: 0,
    failed: 0,
    timedOut: 0,
    verifyPassed: 0,
    verifyFailed: 0,
    lastEventAt: 0,
    ...over,
  };
}

describe('agentStats persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('records events and reads them back', () => {
    recordAgentEvent(W, 's1', 'agent-1', 'sentinel-done');
    recordAgentEvent(W, 's1', 'agent-1', 'verify-passed');
    recordAgentEvent(W, 's2', 'agent-2', 'failed');

    const s1 = getAgentStats(W, 's1');
    expect(s1?.sentinelDone).toBe(1);
    expect(s1?.verifyPassed).toBe(1);
    expect(s1?.failed).toBe(0);
    expect(getAgentStats(W, 's2')?.failed).toBe(1);
  });

  it('scopes stats per workspace', () => {
    recordAgentEvent(W, 's1', 'agent-1', 'failed');
    expect(getAgentStats('other-ws', 's1')).toBeNull();
  });

  it('ignores events for tasks with no session (user gates etc.)', () => {
    recordAgentEvent(W, '', 'nobody', 'failed');
    expect(getAgentStats(W, '')).toBeNull();
  });
});

describe('trustScore', () => {
  it('returns null for agents with no history', () => {
    expect(trustScore(stats({}))).toBeNull();
  });

  it('scores a perfect agent at 100', () => {
    expect(trustScore(stats({ sentinelDone: 5 }))).toBe(100);
  });

  it('penalises failures, and verification offsets a damaged score', () => {
    const clean = trustScore(stats({ sentinelDone: 4 }))!;
    const withFails = trustScore(stats({ sentinelDone: 4, failed: 2 }))!;
    // Same failure history, but half the work was verified — scores higher.
    const withFailsVerified = trustScore(stats({ sentinelDone: 4, failed: 2, verifyPassed: 3 }))!;
    expect(withFails).toBeLessThan(clean);
    expect(withFailsVerified).toBeGreaterThan(withFails);
    expect(withFailsVerified).toBeLessThanOrEqual(clean);
  });

  it('clamps to 0–100', () => {
    expect(trustScore(stats({ failed: 10, verifyFailed: 10 }))).toBeGreaterThanOrEqual(0);
    expect(
      trustScore(stats({ sentinelDone: 10, softDone: 10, verifyPassed: 20 }))
    ).toBeLessThanOrEqual(100);
  });
});
