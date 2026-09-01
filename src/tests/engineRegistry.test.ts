import { describe, it, expect, vi } from 'vitest';
import { workspaceEngines, WorkspaceEngineRegistry } from '../services/engineRegistry';
import type { OrchestratorEngine, EngineConfig } from '../services/orchestratorEngine';

function makeFakeEngine(): OrchestratorEngine & { updateConfig: ReturnType<typeof vi.fn> } {
  return {
    updateConfig: vi.fn(),
  } as unknown as ReturnType<typeof makeFakeEngine>;
}

describe('WorkspaceEngineRegistry', () => {
  it('returns the same engine instance for the same workspace', () => {
    expect(workspaceEngines.get('ws-1')).toBe(workspaceEngines.get('ws-1'));
  });

  it('returns different engines for different workspaces (concurrent pipelines)', () => {
    expect(workspaceEngines.get('ws-a')).not.toBe(workspaceEngines.get('ws-b'));
  });

  it('applies synced config to live engines AND to engines created later', () => {
    const created: Array<OrchestratorEngine & { updateConfig: ReturnType<typeof vi.fn> }> = [];
    const configs: EngineConfig[] = [];
    const registry = new WorkspaceEngineRegistry((config: EngineConfig) => {
      configs.push(config);
      const engine = makeFakeEngine();
      created.push(engine);
      return engine;
    });

    const first = registry.get('ws-1');
    registry.syncConfig({ taskTimeoutMinutes: 7 });

    // Existing engine received the update immediately.
    expect(first.updateConfig).toHaveBeenCalledWith({ taskTimeoutMinutes: 7 });

    // An engine created after the sync is constructed WITH the synced value.
    registry.get('ws-2');
    expect(configs[1]).toMatchObject({ taskTimeoutMinutes: 7 });
    expect(created).toHaveLength(2);
  });

  it('creates engines lazily — nothing is constructed until first requested', () => {
    const factory = vi.fn(() => makeFakeEngine());
    const registry = new WorkspaceEngineRegistry(factory);
    expect(factory).not.toHaveBeenCalled();
    registry.get('only-ws');
    expect(factory).toHaveBeenCalledTimes(1);
    registry.get('only-ws');
    expect(factory).toHaveBeenCalledTimes(1); // same instance reused
  });
});
