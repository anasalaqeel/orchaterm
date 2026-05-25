import { invoke } from '@tauri-apps/api/core';
import { AppData, AppSettings, OrchestratorPlan } from '../types';

const FILE_DATA  = 'agentdeck_data.json';
const FILE_PLANS = 'agentdeck_plans.json';
const FILE_UI    = 'agentdeck_ui.json';
const FILE_TERMS = 'agentdeck_terminals.json';

// ── Tauri detection ────────────────────────────────────────────────────────────

export function isTauri(): boolean {
  return typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
}

// ── Defaults ───────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: AppSettings = {
  shellPath: 'powershell.exe',
  ollamaHost: 'http://localhost:11434',
  openaiApiKey: '',
  anthropicApiKey: '',
  conductorOllamaModel: '',
  conductorTaskTimeoutMinutes: 30,
};

const DEFAULT_DATA: AppData = {
  workspaces: [],
  spaces: [],
  taskLogs: [],
  savedPrompts: [],
  settings: DEFAULT_SETTINGS,
};

// ── Low-level read / write ─────────────────────────────────────────────────────

async function readFile(name: string): Promise<string> {
  if (isTauri()) {
    return invoke<string>('load_store', { file: name });
  }
  return localStorage.getItem(`agentdeck:${name}`) ?? '';
}

async function writeFile(name: string, content: string): Promise<void> {
  if (isTauri()) {
    await invoke('save_store', { file: name, data: content });
  } else {
    localStorage.setItem(`agentdeck:${name}`, content);
  }
}

// ── Migration ──────────────────────────────────────────────────────────────────

function migrate(parsed: any): AppData {
  if (parsed.agents) delete parsed.agents;

  if (parsed.agentGroups && !parsed.spaces) {
    parsed.spaces = parsed.agentGroups;
    delete parsed.agentGroups;
  }

  if (Array.isArray(parsed.taskLogs)) {
    parsed.taskLogs = parsed.taskLogs.map((l: any) => {
      if ('groupId' in l && !('spaceId' in l)) {
        const { groupId, ...rest } = l;
        l = { ...rest, spaceId: groupId };
      }
      // Normalise '' → null
      return { ...l, spaceId: l.spaceId === '' ? null : (l.spaceId ?? null) };
    });
  }

  if (Array.isArray(parsed.savedPrompts)) {
    parsed.savedPrompts = parsed.savedPrompts.map((p: any) => {
      if ('groupId' in p && !('spaceId' in p)) {
        const { groupId, ...rest } = p;
        p = { ...rest, spaceId: groupId };
      }
      // Normalise '' → null
      return { ...p, spaceId: p.spaceId === '' ? null : (p.spaceId ?? null) };
    });
  }

  return { ...DEFAULT_DATA, ...parsed };
}

function migratePlans(plans: any[]): OrchestratorPlan[] {
  return plans.map((p: any) => {
    // Rename groupId → spaceId (old data)
    if ('groupId' in p && !('spaceId' in p)) {
      const { groupId, ...rest } = p;
      p = { ...rest, spaceId: groupId };
    }
    // Normalise empty-string spaceId → null
    if (p.spaceId === '') {
      p = { ...p, spaceId: null };
    }
    return p as OrchestratorPlan;
  });
}

// ── UI state (active workspace/space/viewMode) ─────────────────────────────────

export interface UIState {
  activeWorkspaceId: string | null;
  activeSpaceId: string | null;
  viewMode: 'grid' | 'console';
}

const DEFAULT_UI: UIState = {
  activeWorkspaceId: null,
  activeSpaceId: null,
  viewMode: 'grid',
};

export async function loadUIState(): Promise<UIState> {
  try {
    const raw = await readFile(FILE_UI);
    if (!raw) return DEFAULT_UI;
    return { ...DEFAULT_UI, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_UI;
  }
}

export async function saveUIState(state: UIState): Promise<void> {
  try {
    await writeFile(FILE_UI, JSON.stringify(state));
  } catch (err) {
    console.error('[storage] saveUIState failed:', err);
  }
}

// ── Terminal tab metadata ──────────────────────────────────────────────────────
// Keyed by scope (workspaceId::spaceId or workspaceId::workspace).
// PTY output is NOT saved — only tab structure (title, shell, color, order).
// On restore, fresh PTY sessions are spawned with the saved metadata.

export interface PersistedTab {
  title: string;
  shell: string;
  shellArgs: string[];
  color: string | null;
  order: number;
}

export type TerminalTabsState = Record<string, PersistedTab[]>;

export async function loadTerminalTabs(): Promise<TerminalTabsState> {
  try {
    const raw = await readFile(FILE_TERMS);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function saveTerminalTabs(tabs: TerminalTabsState): Promise<void> {
  try {
    await writeFile(FILE_TERMS, JSON.stringify(tabs));
  } catch (err) {
    console.error('[storage] saveTerminalTabs failed:', err);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function loadData(): Promise<AppData> {
  try {
    const raw = await readFile(FILE_DATA);
    if (!raw) return DEFAULT_DATA;
    return migrate(JSON.parse(raw));
  } catch (err) {
    console.error('[storage] loadData failed:', err);
    return DEFAULT_DATA;
  }
}

export async function saveData(data: AppData): Promise<void> {
  try {
    await writeFile(FILE_DATA, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[storage] saveData failed:', err);
  }
}

export async function loadPlans(): Promise<OrchestratorPlan[]> {
  try {
    const raw = await readFile(FILE_PLANS);
    if (!raw) return [];
    return migratePlans(JSON.parse(raw));
  } catch (err) {
    console.error('[storage] loadPlans failed:', err);
    return [];
  }
}

export async function savePlans(plans: OrchestratorPlan[]): Promise<void> {
  try {
    await writeFile(FILE_PLANS, JSON.stringify(plans, null, 2));
  } catch (err) {
    console.error('[storage] savePlans failed:', err);
  }
}
