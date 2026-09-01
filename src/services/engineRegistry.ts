/**
 * engineRegistry.ts
 *
 * One OrchestratorEngine per workspace. Engines are plan-scoped by design
 * (every OrchestratorPlan carries its workspaceId) — this registry just owns
 * one instance per workspace so two workspaces can run pipelines
 * concurrently, each with its own live plan, logs, and blackboard.
 *
 * Lazily created on first use and never evicted: an idle engine is a small
 * object holding at most one finished plan.
 *
 * Settings-level config (providers, timeouts, interaction mode) is global —
 * synced through syncConfig, remembered here, and applied to engines created
 * later. Run-time config (sessionTitles, workspacePath) is per plan and set
 * by the launching panel at start() time.
 */

import { OrchestratorEngine, EngineConfig } from './orchestratorEngine';
import { createProvider } from './llm';

const _defaultProvider = createProvider({ provider: 'ollama', model: 'llama3.2' });

function defaultConfig(): EngineConfig {
  return {
    relayProvider: _defaultProvider,
    plannerProvider: _defaultProvider,
    autoAnswerProvider: _defaultProvider,
    taskTimeoutMinutes: 0,
    interactionMode: 'auto',
    sessionTitles: new Map(),
    workspacePath: '',
  };
}

export class WorkspaceEngineRegistry {
  private engines = new Map<string, OrchestratorEngine>();
  /** Global settings-level config, merged into every new engine on creation. */
  private globalConfig: Partial<EngineConfig> = {};

  constructor(
    /** Injectable for tests — production callers use the default export. */
    private readonly createEngine: (config: EngineConfig) => OrchestratorEngine = (config) =>
      new OrchestratorEngine(config)
  ) {}

  /** The engine for a workspace, created on first use. Same instance always. */
  get(workspaceId: string): OrchestratorEngine {
    let engine = this.engines.get(workspaceId);
    if (!engine) {
      engine = this.createEngine({ ...defaultConfig(), ...this.globalConfig });
      this.engines.set(workspaceId, engine);
    }
    return engine;
  }

  /**
   * Apply settings-level config to every live engine and remember it for
   * engines created later. Callers must not pass run-time fields
   * (sessionTitles / workspacePath) — those belong to the launching panel.
   */
  syncConfig(config: Partial<EngineConfig>): void {
    this.globalConfig = { ...this.globalConfig, ...config };
    for (const engine of this.engines.values()) engine.updateConfig(config);
  }
}

export const workspaceEngines = new WorkspaceEngineRegistry();
