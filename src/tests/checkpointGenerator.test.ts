import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateCheckpoint } from '../services/checkpointGenerator';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/continuationPrompts', () => ({
  buildCheckpointNarrativePrompt: vi.fn().mockReturnValue({
    system: 'sys',
    userContent: 'user',
  }),
}));

vi.mock('../services/sentinelParser', () => ({
  stripAnsiCodes: vi.fn((s: string) => s),
}));

const mockLlm = {
  complete: vi.fn().mockResolvedValue(
    '## What Was Done\nBuilt auth module.\n\n## Files Modified\n- src/auth.ts — added JWT logic\n\n## Decisions Made\nUsed HS256.\n\n## Where It Stopped\nHalfway through refresh token.\n\n## What Needs To Happen Next\nFinish refresh token endpoint.\n\n## Resume Prompt\nContinue building the refresh token endpoint in src/auth.ts.'
  ),
  stream: vi.fn(),
  listModels: vi.fn().mockResolvedValue([]),
  checkOnline: vi.fn().mockResolvedValue(true),
};

describe('generateCheckpoint', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a CheckpointSnapshot with correct shape', async () => {
    const snapshot = await generateCheckpoint(
      {
        sessionId: 'sess-1',
        sessionTitle: 'Claude',
        rawBuffer: 'some terminal output',
        workspacePath: '/home/user/myproject',
        triggeredBy: 'auto-detection',
        label: 'LIMIT_HIT',
      },
      mockLlm,
    );

    expect(snapshot.sessionId).toBe('sess-1');
    expect(snapshot.sessionTitle).toBe('Claude');
    expect(snapshot.triggeredBy).toBe('auto-detection');
    expect(snapshot.label).toBe('LIMIT_HIT');
    expect(snapshot.filePath).toContain('.orchaterm/checkpoints');
    expect(snapshot.filePath).toContain('Claude');
    expect(typeof snapshot.id).toBe('string');
    expect(typeof snapshot.createdAt).toBe('number');
  });

  it('calls invoke with write_file_path', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    await generateCheckpoint(
      {
        sessionId: 'sess-1',
        sessionTitle: 'Claude',
        rawBuffer: 'output',
        workspacePath: '/home/user/myproject',
        triggeredBy: 'manual',
        label: 'STOPPED',
      },
      mockLlm,
    );
    expect(invoke).toHaveBeenCalledWith('write_file_path', expect.objectContaining({
      path: expect.stringContaining('.orchaterm/checkpoints'),
      content: expect.stringContaining('# Checkpoint: Claude'),
    }));
  });

  it('writes partial checkpoint when LLM fails', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const failingLlm = {
      ...mockLlm,
      complete: vi.fn().mockRejectedValue(new Error('LLM offline')),
    };
    await generateCheckpoint(
      {
        sessionId: 'sess-1',
        sessionTitle: 'Claude',
        rawBuffer: 'output',
        workspacePath: '/home/user/proj',
        triggeredBy: 'manual',
        label: 'STOPPED',
      },
      failingLlm,
    );
    const call = vi.mocked(invoke).mock.calls[0];
    expect((call[1] as any).content).toContain('LLM unavailable');
  });
});
