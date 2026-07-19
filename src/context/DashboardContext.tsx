import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  Workspace, Space, TaskLog, SavedPrompt, AppData, AppSettings,
  OrchestratorPlan, TerminalSession, PipelineTemplate,
} from '../types';
import {
  loadData, saveData, loadPlans, savePlans,
  loadPipelineTemplates, savePipelineTemplates,
  loadUIState, saveUIState,
} from '../services/storage';
import { createProvider, LLMProvider } from '../services/llm';
import type { UseCaseProviders } from '../services/llm/types';
import { orchestratorEngine } from '../services/orchestratorEngine';
import { autonomousOrchestrator } from '../services/autonomousOrchestrator';
import { needsBroker } from '../services/needsBroker';
import { sessionContinuationService } from '../services/sessionContinuationService';
import { writePtyChunked } from '../utils/ptyUtils';
import type { DetectionEvent, CheckpointSnapshot } from '../types';
import { DEFAULT_TERMINAL_CONFIG, mergeTerminalConfig } from '../utils/terminalThemes';

export const DEFAULT_TERMINAL_WORKSPACE: Workspace = {
  id: 'global-default-terminal',
  name: 'Terminal',
  path: '',
  description: 'Global scratch terminal',
  color: '#8b5cf6',
  status: 'active',
  currentTask: '',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export interface ToastInfo {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'loading';
  persistent?: boolean;
}

export interface DashboardContextType {
  // ── Core state ──────────────────────────────────────────────────────────────
  workspaces: Workspace[];
  spaces: Space[];
  taskLogs: TaskLog[];
  savedPrompts: SavedPrompt[];

  // ── Navigation / view state ─────────────────────────────────────────────────
  activeWorkspaceId: string | null;
  setActiveWorkspaceId: (id: string | null) => void;
  viewMode: 'grid' | 'console';
  setViewMode: (mode: 'grid' | 'console') => void;
  /** The active Space in the console view. Scopes Conductor + Chat. */
  activeSpaceId: string | null;
  setActiveSpaceId: (id: string | null) => void;

  // ── UI helpers ──────────────────────────────────────────────────────────────
  toast: ToastInfo | null;
  setToast: (toast: ToastInfo | null) => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'loading', persistent?: boolean) => void;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  isLoaded: boolean;
  /** Signals the Overview page to open the New Workspace modal immediately. */
  newWorkspaceModalOpen: boolean;
  setNewWorkspaceModalOpen: (open: boolean) => void;
  /** Help/keyboard shortcuts modal state */
  helpModalOpen: boolean;
  setHelpModalOpen: (open: boolean) => void;

  // ── Workspace CRUD ──────────────────────────────────────────────────────────
  addWorkspace: (workspace: Omit<Workspace, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateWorkspace: (id: string, updates: Partial<Workspace>) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;

  // ── Space CRUD ──────────────────────────────────────────────────────────────
  addSpace: (space: Omit<Space, 'id' | 'createdAt'>) => Promise<void>;
  updateSpace: (id: string, updates: Partial<Space>) => Promise<void>;
  deleteSpace: (id: string) => Promise<void>;

  // ── Task Log CRUD ───────────────────────────────────────────────────────────
  addTaskLog: (log: Omit<TaskLog, 'id' | 'timestamp'>) => Promise<void>;
  updateTaskLog: (id: string, updates: Partial<TaskLog>) => Promise<void>;
  deleteTaskLog: (id: string) => Promise<void>;

  // ── Prompt CRUD ─────────────────────────────────────────────────────────────
  addSavedPrompt: (prompt: Omit<SavedPrompt, 'id' | 'createdAt' | 'usedAt'>) => Promise<void>;
  updateSavedPrompt: (id: string, updates: Partial<SavedPrompt>) => Promise<void>;
  deleteSavedPrompt: (id: string) => Promise<void>;
  copyPromptToClipboard: (promptId: string) => Promise<void>;

  // ── Settings ────────────────────────────────────────────────────────────────
  settings: AppSettings;
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>;
  exportSettings: () => string;
  importSettings: (jsonData: string) => Promise<boolean>;

  // ── Live LLM provider instances ─────────────────────────────────────────────
  /** Provider instances, recreated when settings.llmProviders changes. */
  llmProviders: {
    relay:      LLMProvider;
    planGen:    LLMProvider;
    autoAnswer: LLMProvider;
    chat:       LLMProvider;
    routing:    LLMProvider;
  };

  // ── Orchestrator plans (persisted) ──────────────────────────────────────────
  plans: OrchestratorPlan[];
  addPlan: (plan: OrchestratorPlan) => Promise<void>;
  updatePlan: (id: string, updates: Partial<OrchestratorPlan>) => Promise<void>;
  deletePlan: (id: string) => Promise<void>;

  // ── Pipeline templates (persisted) ──────────────────────────────────────────
  pipelineTemplates: PipelineTemplate[];
  addPipelineTemplate: (template: Omit<PipelineTemplate, 'id' | 'createdAt' | 'usedAt' | 'useCount'>) => Promise<void>;
  updatePipelineTemplate: (id: string, updates: Partial<PipelineTemplate>) => Promise<void>;
  deletePipelineTemplate: (id: string) => Promise<void>;
  incrementTemplateUse: (id: string) => Promise<void>;

  // ── Terminal sessions (ephemeral — not persisted, reset each launch) ────────
  terminalSessions: TerminalSession[];
  addTerminalSession: (session: TerminalSession) => void;
  removeTerminalSession: (sessionId: string) => void;
  updateTerminalSession: (sessionId: string, updates: Partial<TerminalSession>) => void;

  // ── Session continuation ─────────────────────────────────────────────────────────────────────
  lastCheckpoint: CheckpointSnapshot | null;
  pendingInjectionSnapshot: CheckpointSnapshot | null;
  setPendingInjectionSnapshot: (s: CheckpointSnapshot | null) => void;
  captureSessionNow: (sessionId: string) => Promise<void>;
}

const DashboardContext = createContext<DashboardContextType | undefined>(undefined);

const DEFAULT_OLLAMA_CONFIG = {
  provider: 'ollama' as const,
  model: 'llama3.2',
  baseUrl: 'http://localhost:11434',
};

/** Migrate settings from legacy ollamaHost/conductorOllamaModel to llmProviders. */
function migrateSettings(raw: Partial<AppSettings>): AppSettings {
  if (raw.llmProviders) {
    return {
      shellPath: raw.shellPath ?? '',
      conductorTaskTimeoutMinutes: raw.conductorTaskTimeoutMinutes ?? 0,
      conductorInteractionMode: raw.conductorInteractionMode ?? 'auto',
      llmProviders: {
        relay:      raw.llmProviders.relay      ?? { ...DEFAULT_OLLAMA_CONFIG },
        planGen:    raw.llmProviders.planGen    ?? { ...DEFAULT_OLLAMA_CONFIG },
        autoAnswer: raw.llmProviders.autoAnswer ?? { ...DEFAULT_OLLAMA_CONFIG },
        chat:       raw.llmProviders.chat       ?? { ...DEFAULT_OLLAMA_CONFIG },
        routing:    raw.llmProviders.routing    ?? { ...DEFAULT_OLLAMA_CONFIG },
      },
      llmProviderMode: raw.llmProviderMode ?? 'advanced',
      simpleLlmProvider: raw.simpleLlmProvider ?? (raw.llmProviders.relay ?? { ...DEFAULT_OLLAMA_CONFIG }),
      providerApiKeys: raw.providerApiKeys ?? {},
      terminalConfig: mergeTerminalConfig(raw.terminalConfig),
      continuation: raw.continuation ?? {
        enabled: false,
        targetSessionId: null,
        mode: 'semi',
        snapshotIntervalChars: 4000,
      },
      aiEnabled: raw.aiEnabled !== false,
      quickActions: raw.quickActions,
    };
  }

  const legacyConfig = {
    provider: 'ollama' as const,
    model: raw.conductorOllamaModel || 'llama3.2',
    baseUrl: raw.ollamaHost || 'http://localhost:11434',
  };
  return {
    shellPath: raw.shellPath ?? '',
    conductorTaskTimeoutMinutes: raw.conductorTaskTimeoutMinutes ?? 0,
    conductorInteractionMode: raw.conductorInteractionMode ?? 'auto',
    llmProviders: {
      relay:      { ...legacyConfig },
      planGen:    { ...legacyConfig },
      autoAnswer: { ...legacyConfig },
      chat:       { ...legacyConfig },
      routing:    { ...legacyConfig },
    },
    llmProviderMode: raw.llmProviderMode ?? 'advanced',
    simpleLlmProvider: raw.simpleLlmProvider ?? { ...legacyConfig },
    providerApiKeys: raw.providerApiKeys ?? {},
    terminalConfig: { ...DEFAULT_TERMINAL_CONFIG, ...(raw.terminalConfig ?? {}) },
    continuation: raw.continuation ?? {
      enabled: false,
      targetSessionId: null,
      mode: 'semi',
      snapshotIntervalChars: 4000,
    },
    aiEnabled: raw.aiEnabled !== false,
    quickActions: raw.quickActions,
  };
}

function getEffectiveProviders(settings: AppSettings): UseCaseProviders {
  if (settings.llmProviderMode === 'simple' && settings.simpleLlmProvider) {
    return {
      relay:      { ...settings.simpleLlmProvider },
      planGen:    { ...settings.simpleLlmProvider },
      autoAnswer: { ...settings.simpleLlmProvider },
      chat:       { ...settings.simpleLlmProvider },
      routing:    { ...settings.simpleLlmProvider },
    };
  }
  return settings.llmProviders;
}

function makeProviders(cfg: UseCaseProviders) {
  return {
    relay:      createProvider(cfg.relay),
    planGen:    createProvider(cfg.planGen),
    autoAnswer: createProvider(cfg.autoAnswer),
    chat:       createProvider(cfg.chat),
    routing:    createProvider(cfg.routing),
  };
}

export const DashboardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [workspaces, setWorkspaces]     = useState<Workspace[]>([]);
  const [spaces, setSpaces]             = useState<Space[]>([]);
  const [taskLogs, setTaskLogs]         = useState<TaskLog[]>([]);
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [activeSpaceId, setActiveSpaceId]         = useState<string | null>(null);
  const [viewMode, setViewMode]         = useState<'grid' | 'console'>('grid');
  const [toast, setToast]               = useState<ToastInfo | null>(null);
  const [theme, setTheme]               = useState<'dark' | 'light'>('dark');
  const [isLoaded, setIsLoaded]         = useState<boolean>(false);
  const [newWorkspaceModalOpen, setNewWorkspaceModalOpen] = useState(false);
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  const [settings, setSettings]         = useState<AppSettings>({
    shellPath: '',
    conductorTaskTimeoutMinutes: 0,
    conductorInteractionMode: 'auto',
    llmProviders: {
      relay:      { ...DEFAULT_OLLAMA_CONFIG },
      planGen:    { ...DEFAULT_OLLAMA_CONFIG },
      autoAnswer: { ...DEFAULT_OLLAMA_CONFIG },
      chat:       { ...DEFAULT_OLLAMA_CONFIG },
      routing:    { ...DEFAULT_OLLAMA_CONFIG },
    },
    llmProviderMode: 'advanced',
    simpleLlmProvider: { ...DEFAULT_OLLAMA_CONFIG },
    providerApiKeys: {},
    terminalConfig: DEFAULT_TERMINAL_CONFIG,
    continuation: {
      enabled: false,
      targetSessionId: null,
      mode: 'semi',
      snapshotIntervalChars: 4000,
    },
  });
  const [plans, setPlans]                       = useState<OrchestratorPlan[]>([]);
  const [pipelineTemplates, setPipelineTemplates] = useState<PipelineTemplate[]>([]);
  const [terminalSessions, setTerminalSessions] = useState<TerminalSession[]>([]);
  const [lastCheckpoint, setLastCheckpoint] = useState<CheckpointSnapshot | null>(null);
  const [pendingInjectionSnapshot, setPendingInjectionSnapshot] = useState<CheckpointSnapshot | null>(null);
  /** Sessions currently running agents under autonomous orchestration (the agent tabs). */
  const [agentSessionIds, setAgentSessionIds] = useState<string[]>([]);
  const [llmProviders, setLlmProviders] = useState(() =>
    makeProviders({
      relay:      { ...DEFAULT_OLLAMA_CONFIG },
      planGen:    { ...DEFAULT_OLLAMA_CONFIG },
      autoAnswer: { ...DEFAULT_OLLAMA_CONFIG },
      chat:       { ...DEFAULT_OLLAMA_CONFIG },
      routing:    { ...DEFAULT_OLLAMA_CONFIG },
    })
  );

  // ── Load from storage on mount ───────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      try {
        const [data, ui, savedPlans, savedTemplates] = await Promise.all([
          loadData(),
          loadUIState(),
          loadPlans(),
          loadPipelineTemplates(),
        ]);

        const ws  = data.workspaces || [];
        const sps = data.spaces    || [];

        setWorkspaces(ws);
        setSpaces(sps);
        setTaskLogs(data.taskLogs || []);
        setSavedPrompts(data.savedPrompts || []);
        if (data.settings) setSettings(migrateSettings(data.settings));
        setPlans(savedPlans);
        setPipelineTemplates(savedTemplates);

        // Restore active workspace — validate it still exists
        if (ui.activeWorkspaceId === DEFAULT_TERMINAL_WORKSPACE.id) {
          setActiveWorkspaceId(ui.activeWorkspaceId);
        } else if (ui.activeWorkspaceId && ws.some(w => w.id === ui.activeWorkspaceId)) {
          setActiveWorkspaceId(ui.activeWorkspaceId);
        } else if (ws.length > 0) {
          setActiveWorkspaceId(ws[0].id);
        }

        // Restore active space — validate it still exists
        if (ui.activeSpaceId && sps.some(sp => sp.id === ui.activeSpaceId)) {
          setActiveSpaceId(ui.activeSpaceId);
        }

        // Restore view mode
        setViewMode(ui.viewMode);

        const savedTheme = localStorage.getItem('orchaterm_theme');
        setTheme(savedTheme === 'light' ? 'light' : 'dark');
      } catch (err) {
        console.error('Error loading initial data', err);
      } finally {
        setIsLoaded(true);
      }
    };
    init();
  }, []);

  // ── Persist UI state on change (debounced) ───────────────────────────────────
  const uiSaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isLoaded) return; // wait until initial load is complete
    if (uiSaveTimer.current) clearTimeout(uiSaveTimer.current);
    uiSaveTimer.current = setTimeout(() => {
      saveUIState({ activeWorkspaceId, activeSpaceId, viewMode });
    }, 400);
    return () => { if (uiSaveTimer.current) clearTimeout(uiSaveTimer.current); };
  }, [activeWorkspaceId, activeSpaceId, viewMode, isLoaded]);

  // ── Sync theme ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const root = window.document.body;
    if (theme === 'light') {
      root.classList.add('light');
      localStorage.setItem('orchaterm_theme', 'light');
    } else {
      root.classList.remove('light');
      localStorage.setItem('orchaterm_theme', 'dark');
    }
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // ── Auto-clear toast ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!toast) return;
    if (toast.type === 'loading' || toast.persistent) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Sync LLM providers to engines when settings change ───────────────────────
  useEffect(() => {
    if (!isLoaded) return;
    const effectiveCfg = getEffectiveProviders(settings);
    const p = makeProviders(effectiveCfg);
    setLlmProviders(p);

    // NOTE: sessionTitles is intentionally omitted here — the run paths
    // (handleApproveAndRun / handleRunPlan) populate it with the live session
    // map at launch. updateConfig is a partial merge, so we don't clobber it.
    orchestratorEngine.updateConfig({
      relayProvider:      p.relay,
      planGenProvider:    p.planGen,
      autoAnswerProvider: p.autoAnswer,
      taskTimeoutMinutes: settings.conductorTaskTimeoutMinutes,
      interactionMode:    settings.conductorInteractionMode,
    });

    autonomousOrchestrator.updateConfig({ routingProvider: p.routing });
    needsBroker.updateConfig({ provider: p.planGen });
  }, [settings.llmProviders, settings.llmProviderMode, settings.simpleLlmProvider, settings.conductorTaskTimeoutMinutes, settings.conductorInteractionMode, isLoaded]);

  // ── Wire continuation service events to UI state ─────────────────────────────
  useEffect(() => {
    return sessionContinuationService.onEvent((event: DetectionEvent) => {
      if (event.type !== 'checkpoint-written' || !event.snapshot) return;
      setLastCheckpoint(event.snapshot);

      // Periodic snapshots are silent breadcrumbs — never pop the modal
      if (event.snapshot.triggeredBy === 'periodic') return;

      const continuationCfg = settings.continuation;
      if (!continuationCfg?.enabled) return;

      if (continuationCfg.mode === 'file-only') {
        showToast(`Checkpoint saved: ${event.snapshot.sessionTitle}`, 'info');
        return;
      }

      const mode = continuationCfg.mode;
      const targetId = continuationCfg.targetSessionId;

      if (mode === 'auto' && targetId) {
        const message =
          'Continue working on the following task. A previous agent session stopped mid-way. ' +
          `Here is the full context of what happened and what needs to happen next:\n\n` +
          `Checkpoint file: ${event.snapshot.filePath}\n\n` +
          `Please read the checkpoint file and continue from where the previous session stopped.`;
        writePtyChunked(targetId, message + '\r').catch(() => {});
        showToast(`Auto-resumed ${event.snapshot.sessionTitle} in target session`, 'success');
      } else {
        setPendingInjectionSnapshot(event.snapshot);
      }
    });
  }, [settings.continuation]);

  // ── Track which sessions are running agents (autonomous orchestration) ───────
  // Continuation only watches these — never bare interactive terminals, whose
  // returning shell prompt the detector would otherwise misread as "stopped".
  useEffect(() => {
    const sync = () => setAgentSessionIds(autonomousOrchestrator.getActiveSessionIds());
    sync();
    return autonomousOrchestrator.onActiveChange(sync);
  }, []);

  // ── Start/stop session continuation monitoring (scoped to agent sessions) ────
  useEffect(() => {
    const enabled = settings.aiEnabled !== false && (settings.continuation?.enabled ?? false);
    const agentSet = new Set(agentSessionIds);

    // Stop monitoring anything that is no longer an active agent session
    // (covers the feature being disabled, a space stopping, or a tab closing).
    for (const id of sessionContinuationService.getMonitoredSessionIds()) {
      if (!enabled || !agentSet.has(id)) {
        sessionContinuationService.stopMonitoring(id);
      }
    }

    if (!enabled) return;

    const workspace = workspaces.find(w => w.id === activeWorkspaceId);
    const workspacePath = workspace?.path ?? '';
    if (!workspacePath) return;

    for (const session of terminalSessions) {
      if (!agentSet.has(session.id)) continue;
      if (!sessionContinuationService.isMonitoring(session.id)) {
        void sessionContinuationService.startMonitoring(
          { id: session.id, title: session.title, workspacePath },
          settings.continuation!,
          llmProviders.routing,
          llmProviders.relay,
        );
      }
    }
  }, [agentSessionIds, terminalSessions, settings.aiEnabled, settings.continuation, activeWorkspaceId, workspaces, llmProviders.routing, llmProviders.relay]);

  const showToast = (message: string, type: 'success' | 'error' | 'info' | 'loading' = 'info', persistent = false) => {
    setToast({ id: crypto.randomUUID(), message, type, persistent });
  };

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

  // ── Persist helper ───────────────────────────────────────────────────────────
  const persist = async (
    ws: Workspace[],
    sps: Space[],
    logs: TaskLog[],
    prompts: SavedPrompt[],
    s?: AppSettings,
  ) => {
    const data: AppData = {
      workspaces: ws,
      spaces: sps,
      taskLogs: logs,
      savedPrompts: prompts,
      settings: s ?? settings,
    };
    await saveData(data);
  };

  // ── Settings ─────────────────────────────────────────────────────────────────
  const updateSettings = async (updates: Partial<AppSettings>) => {
    const next = { ...settings, ...updates };
    setSettings(next);
    await persist(workspaces, spaces, taskLogs, savedPrompts, next);
    showToast('Settings saved', 'success');
  };

  // ── Workspace CRUD ───────────────────────────────────────────────────────────
  const addWorkspace = async (w: Omit<Workspace, 'id' | 'createdAt' | 'updatedAt'>) => {
    const next: Workspace = {
      ...w,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const nextWs = [...workspaces, next];
    setWorkspaces(nextWs);
    if (!activeWorkspaceId) setActiveWorkspaceId(next.id);
    await persist(nextWs, spaces, taskLogs, savedPrompts);
    showToast(`Workspace "${w.name}" created`, 'success');
  };

  const updateWorkspace = async (id: string, updates: Partial<Workspace>) => {
    const next = workspaces.map(w =>
      w.id === id ? { ...w, ...updates, updatedAt: new Date().toISOString() } : w,
    );
    setWorkspaces(next);
    await persist(next, spaces, taskLogs, savedPrompts);
  };

  const deleteWorkspace = async (id: string) => {
    const nextWs = workspaces.filter(w => w.id !== id);
    setWorkspaces(nextWs);
    if (activeWorkspaceId === id) {
      setActiveWorkspaceId(nextWs.length > 0 ? nextWs[0].id : null);
    }

    // Cascade-delete spaces belonging to this workspace
    const nextSpaces = spaces.filter(sp => sp.workspaceId !== id);
    setSpaces(nextSpaces);

    const nextLogs    = taskLogs.filter(l => l.workspaceId !== id);
    const nextPrompts = savedPrompts.filter(p => p.workspaceId !== id);
    setTaskLogs(nextLogs);
    setSavedPrompts(nextPrompts);

    await persist(nextWs, nextSpaces, nextLogs, nextPrompts);
    showToast('Workspace deleted', 'info');
  };

  // ── Space CRUD ───────────────────────────────────────────────────────────────
  const addSpace = async (sp: Omit<Space, 'id' | 'createdAt'>) => {
    const next: Space = { ...sp, id: crypto.randomUUID(), createdAt: Date.now() };
    const nextSpaces = [...spaces, next];
    setSpaces(nextSpaces);
    await persist(workspaces, nextSpaces, taskLogs, savedPrompts);
    showToast(`Space "${sp.name}" created`, 'success');
  };

  const updateSpace = async (id: string, updates: Partial<Space>) => {
    const next = spaces.map(sp => sp.id === id ? { ...sp, ...updates } : sp);
    setSpaces(next);
    await persist(workspaces, next, taskLogs, savedPrompts);
  };

  const deleteSpace = async (id: string) => {
    const next = spaces.filter(sp => sp.id !== id);
    setSpaces(next);
    if (activeSpaceId === id) setActiveSpaceId(null);
    await persist(workspaces, next, taskLogs, savedPrompts);
    showToast('Space deleted', 'info');
  };

  // ── Task Log CRUD ─────────────────────────────────────────────────────────────
  const addTaskLog = async (l: Omit<TaskLog, 'id' | 'timestamp'>) => {
    const next: TaskLog = { ...l, id: crypto.randomUUID(), timestamp: new Date().toISOString() };
    const nextLogs = [next, ...taskLogs];
    setTaskLogs(nextLogs);
    await persist(workspaces, spaces, nextLogs, savedPrompts);
  };

  const updateTaskLog = async (id: string, updates: Partial<TaskLog>) => {
    const next = taskLogs.map(l => l.id === id ? { ...l, ...updates } : l);
    setTaskLogs(next);
    await persist(workspaces, spaces, next, savedPrompts);
  };

  const deleteTaskLog = async (id: string) => {
    const next = taskLogs.filter(l => l.id !== id);
    setTaskLogs(next);
    await persist(workspaces, spaces, next, savedPrompts);
  };

  // ── Prompt CRUD ───────────────────────────────────────────────────────────────
  const addSavedPrompt = async (pr: Omit<SavedPrompt, 'id' | 'createdAt' | 'usedAt'>) => {
    const next: SavedPrompt = {
      ...pr, id: crypto.randomUUID(),
      createdAt: new Date().toISOString(), usedAt: null,
    };
    const nextPrompts = [next, ...savedPrompts];
    setSavedPrompts(nextPrompts);
    await persist(workspaces, spaces, taskLogs, nextPrompts);
    showToast(`Prompt "${pr.title}" saved`, 'success');
  };

  const updateSavedPrompt = async (id: string, updates: Partial<SavedPrompt>) => {
    const next = savedPrompts.map(p => p.id === id ? { ...p, ...updates } : p);
    setSavedPrompts(next);
    await persist(workspaces, spaces, taskLogs, next);
  };

  const deleteSavedPrompt = async (id: string) => {
    const next = savedPrompts.filter(p => p.id !== id);
    setSavedPrompts(next);
    await persist(workspaces, spaces, taskLogs, next);
    showToast('Prompt removed', 'info');
  };

  const copyPromptToClipboard = async (promptId: string) => {
    const pr = savedPrompts.find(p => p.id === promptId);
    if (!pr) { showToast('Prompt not found', 'error'); return; }
    try {
      await navigator.clipboard.writeText(pr.content);
      const next = savedPrompts.map(p =>
        p.id === promptId ? { ...p, usedAt: new Date().toISOString() } : p,
      );
      setSavedPrompts(next);
      await persist(workspaces, spaces, taskLogs, next);
      showToast('Prompt copied to clipboard!', 'success');
    } catch {
      showToast('Failed to copy to clipboard', 'error');
    }
  };

  // ── Plan CRUD ─────────────────────────────────────────────────────────────────
  const addPlan = async (plan: OrchestratorPlan) => {
    const next = [plan, ...plans];
    setPlans(next);
    await savePlans(next);
  };

  const updatePlan = async (id: string, updates: Partial<OrchestratorPlan>) => {
    const next = plans.map(p => p.id === id ? { ...p, ...updates } : p);
    setPlans(next);
    await savePlans(next);
  };

  const deletePlan = async (id: string) => {
    const next = plans.filter(p => p.id !== id);
    setPlans(next);
    await savePlans(next);
  };

  // ── Pipeline Template CRUD ────────────────────────────────────────────────────
  const addPipelineTemplate = async (t: Omit<PipelineTemplate, 'id' | 'createdAt' | 'usedAt' | 'useCount'>) => {
    const next: PipelineTemplate = {
      ...t,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      usedAt: null,
      useCount: 0,
    };
    const nextList = [next, ...pipelineTemplates];
    setPipelineTemplates(nextList);
    await savePipelineTemplates(nextList);
    showToast(`Template "${t.title}" saved`, 'success');
  };

  const updatePipelineTemplate = async (id: string, updates: Partial<PipelineTemplate>) => {
    const next = pipelineTemplates.map(t => t.id === id ? { ...t, ...updates } : t);
    setPipelineTemplates(next);
    await savePipelineTemplates(next);
  };

  const deletePipelineTemplate = async (id: string) => {
    const next = pipelineTemplates.filter(t => t.id !== id);
    setPipelineTemplates(next);
    await savePipelineTemplates(next);
    showToast('Template removed', 'info');
  };

  const incrementTemplateUse = async (id: string) => {
    const next = pipelineTemplates.map(t => t.id === id
      ? { ...t, useCount: t.useCount + 1, usedAt: new Date().toISOString() }
      : t,
    );
    setPipelineTemplates(next);
    await savePipelineTemplates(next);
  };

  const addTerminalSession = (session: TerminalSession) => {
    setTerminalSessions(prev =>
      prev.some(s => s.id === session.id)
        ? prev.map(s => s.id === session.id ? { ...s, ...session } : s)
        : [...prev, session],
    );
    void sessionContinuationService.registerSession(session.id);
  };

  const removeTerminalSession = (sessionId: string) => {
    sessionContinuationService.stopMonitoring(sessionId);
    setTerminalSessions(prev => prev.filter(s => s.id !== sessionId));
  };

  const updateTerminalSession = (sessionId: string, updates: Partial<TerminalSession>) => {
    setTerminalSessions(prev =>
      prev.map(s => s.id === sessionId ? { ...s, ...updates } : s),
    );
  };

  const captureSessionNow = async (sessionId: string): Promise<void> => {
    const workspace = workspaces.find(w => w.id === activeWorkspaceId);
    const workspacePath = workspace?.path ?? '';
    const session = terminalSessions.find(s => s.id === sessionId);

    if (!session) {
      showToast(`Cannot create checkpoint: session ${sessionId} not found`, 'error');
      return;
    }
    if (!workspacePath) {
      showToast(`Cannot create checkpoint: active workspace path is empty`, 'error');
      return;
    }

    const isLocal = (settings.llmProviderMode === 'simple'
      ? settings.simpleLlmProvider?.provider
      : settings.llmProviders?.relay?.provider) === 'ollama';

    const defaultMaxChars = isLocal ? 20000 : 100000;
    const maxContextChars = settings.continuation?.maxContextChars ?? defaultMaxChars;

    updateTerminalSession(sessionId, { isCheckpointing: true });

    try {
      const snapshot = await sessionContinuationService.captureNow(
        sessionId,
        { id: sessionId, title: session.title, workspacePath },
        llmProviders.relay,
        {
          enabled: settings.continuation?.enabled ?? false,
          targetSessionId: settings.continuation?.targetSessionId ?? null,
          mode: settings.continuation?.mode ?? 'semi',
          snapshotIntervalChars: settings.continuation?.snapshotIntervalChars ?? 4000,
          maxContextChars,
        }
      );
      if (snapshot) {
        setLastCheckpoint(snapshot);
        setPendingInjectionSnapshot(snapshot);
        showToast(`Checkpoint created successfully for tab "${session.title}" in workspace "${workspace?.name}"!`, 'success', true);
      } else {
        showToast('Failed to generate checkpoint: checkpoint snapshot is null', 'error', true);
      }
    } catch (err) {
      console.error('captureSessionNow error:', err);
      showToast(`Error creating checkpoint: ${err}`, 'error', true);
    } finally {
      updateTerminalSession(sessionId, { isCheckpointing: false });
    }
  };

  // ── Export / Import ───────────────────────────────────────────────────────────
  const exportSettings = (): string => {
    const data: AppData = {
      workspaces,
      spaces,
      taskLogs,
      savedPrompts,
      settings,
    };
    return JSON.stringify(data, null, 2);
  };

  const importSettings = async (jsonData: string): Promise<boolean> => {
    try {
      const parsed = JSON.parse(jsonData);
      if (!parsed || typeof parsed !== 'object') {
        showToast('Invalid JSON file format', 'error');
        return false;
      }
      const isObj = (v: any) => v !== null && typeof v === 'object';
      const importedWs = Array.isArray(parsed.workspaces)
        ? parsed.workspaces.filter((w: any) => isObj(w) && typeof w.id === 'string')
        : [];
      const importedSpaces = Array.isArray(parsed.spaces)
        ? parsed.spaces.filter((sp: any) => isObj(sp) && typeof sp.id === 'string')
        : [];
      const importedLogs = Array.isArray(parsed.taskLogs)
        ? parsed.taskLogs.filter((l: any) => isObj(l) && typeof l.id === 'string')
        : [];
      const importedPrompts = Array.isArray(parsed.savedPrompts)
        ? parsed.savedPrompts.filter((p: any) => isObj(p) && typeof p.id === 'string')
        : [];
      // Run the same migration as initial load so imported settings always have
      // every nested default (provider slots, terminalConfig, continuation, …)
      // instead of a shallow merge that can leave required fields undefined.
      const importedSettings = isObj(parsed.settings) ? migrateSettings(parsed.settings) : settings;

      setWorkspaces(importedWs);
      setSpaces(importedSpaces);
      setTaskLogs(importedLogs);
      setSavedPrompts(importedPrompts);
      setSettings(importedSettings);
      setActiveWorkspaceId(importedWs.length > 0 ? importedWs[0].id : null);

      await persist(importedWs, importedSpaces, importedLogs, importedPrompts, importedSettings);
      showToast('Settings imported successfully!', 'success');
      return true;
    } catch {
      showToast('Failed to parse settings JSON', 'error');
      return false;
    }
  };

  return (
    <DashboardContext.Provider value={{
      workspaces, spaces, taskLogs, savedPrompts,
      activeWorkspaceId, setActiveWorkspaceId,
      viewMode, setViewMode,
      activeSpaceId, setActiveSpaceId,
      toast, setToast, showToast,
      theme, toggleTheme,
      isLoaded,
      newWorkspaceModalOpen, setNewWorkspaceModalOpen,
      helpModalOpen, setHelpModalOpen,
      addWorkspace, updateWorkspace, deleteWorkspace,
      addSpace, updateSpace, deleteSpace,
      addTaskLog, updateTaskLog, deleteTaskLog,
      addSavedPrompt, updateSavedPrompt, deleteSavedPrompt, copyPromptToClipboard,
      settings, updateSettings, exportSettings, importSettings,
      llmProviders,
      plans, addPlan, updatePlan, deletePlan,
      pipelineTemplates, addPipelineTemplate, updatePipelineTemplate, deletePipelineTemplate, incrementTemplateUse,
      terminalSessions, addTerminalSession, removeTerminalSession, updateTerminalSession,
      lastCheckpoint,
      pendingInjectionSnapshot,
      setPendingInjectionSnapshot,
      captureSessionNow,
    }}>
      {children}
    </DashboardContext.Provider>
  );
};

export const useDashboard = () => {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('useDashboard must be used within a DashboardProvider');
  return ctx;
};
