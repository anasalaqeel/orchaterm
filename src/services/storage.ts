import { readTextFile, writeTextFile, BaseDirectory, exists, mkdir } from '@tauri-apps/plugin-fs';
import { AppData, Agent, AppSettings, OrchestratorPlan } from '../types';

const FILE_NAME       = 'agentdeck_data.json';
const PLANS_FILE_NAME = 'agentdeck_plans.json';

// Cache mkdir so we don't call it on every read/write.
let _dirReady = false;
const ensureDir = async (): Promise<void> => {
  if (_dirReady) return;
  try {
    await mkdir('', { baseDir: BaseDirectory.AppData, recursive: true });
  } catch (_) {}
  _dirReady = true;
};

const DEFAULT_SETTINGS: AppSettings = {
  shellPath: 'powershell.exe',
  ollamaHost: 'http://localhost:11434',
  openaiApiKey: '',
  anthropicApiKey: '',
  conductorOllamaModel: '',            // empty = user must pick from available models
  conductorTaskTimeoutMinutes: 30,
};

const DEFAULT_AGENTS: Agent[] = [
  {
    id: 'agent-1',
    name: 'Claude Code',
    type: 'terminal',
    launchUrl: null,
    launchCommand: 'claude',
    bestUsedFor: 'Interactive CLI agent, quick bug-fixing, and workspace questions',
    assignedWorkspaceId: null,
    color: '#d97706' // Amber
  },
  {
    id: 'agent-2',
    name: 'Antigravity',
    type: 'terminal',
    launchUrl: null,
    launchCommand: 'antigravity',
    bestUsedFor: 'Multi-agent orchestration, complex refactoring, and directory analysis',
    assignedWorkspaceId: null,
    color: '#2563eb' // Blue
  },
  {
    id: 'agent-3',
    name: 'Hermes',
    type: 'terminal',
    launchUrl: null,
    launchCommand: 'hermes',
    bestUsedFor: 'Offline-capable local coding and general explanation',
    assignedWorkspaceId: null,
    color: '#16a34a' // Green
  }
];

const DEFAULT_DATA: AppData = {
  workspaces: [],
  agents: DEFAULT_AGENTS,
  taskLogs: [],
  savedPrompts: [],
  settings: DEFAULT_SETTINGS
};


// Check if running inside Tauri
export function isTauri(): boolean {
  return typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
}

/**
 * Loads data from Tauri's AppData directory, falling back to localStorage if not running in Tauri
 */
export async function loadData(): Promise<AppData> {
  if (!isTauri()) {
    const cached = localStorage.getItem('agentdeck_data');
    return cached ? JSON.parse(cached) : DEFAULT_DATA;
  }

  try {
    await ensureDir();

    const fileExists = await exists(FILE_NAME, { baseDir: BaseDirectory.AppData });
    if (!fileExists) {
      // Write initial default data
      await saveData(DEFAULT_DATA);
      return DEFAULT_DATA;
    }
    const raw = await readTextFile(FILE_NAME, { baseDir: BaseDirectory.AppData });
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error loading data from Tauri FS:', err);
    return DEFAULT_DATA;
  }
}

/**
 * Saves data to Tauri's AppData directory, falling back to localStorage if not running in Tauri
 */
export async function saveData(data: AppData): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem('agentdeck_data', JSON.stringify(data));
    return;
  }

  try {
    await ensureDir();

    const jsonStr = JSON.stringify(data, null, 2);
    await writeTextFile(FILE_NAME, jsonStr, { baseDir: BaseDirectory.AppData });
  } catch (err) {
    console.error('Error saving data to Tauri FS:', err);
  }
}

/**
 * Loads orchestrator plans from a separate file so they don't bloat the main data file.
 */
export async function loadPlans(): Promise<OrchestratorPlan[]> {
  if (!isTauri()) {
    const cached = localStorage.getItem('agentdeck_plans');
    return cached ? JSON.parse(cached) : [];
  }

  try {
    await ensureDir();
    const fileExists = await exists(PLANS_FILE_NAME, { baseDir: BaseDirectory.AppData });
    if (!fileExists) return [];
    const raw = await readTextFile(PLANS_FILE_NAME, { baseDir: BaseDirectory.AppData });
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error loading plans from Tauri FS:', err);
    return [];
  }
}

/**
 * Saves orchestrator plans to a separate file.
 */
export async function savePlans(plans: OrchestratorPlan[]): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem('agentdeck_plans', JSON.stringify(plans));
    return;
  }

  try {
    await ensureDir();
    await writeTextFile(PLANS_FILE_NAME, JSON.stringify(plans, null, 2), {
      baseDir: BaseDirectory.AppData,
    });
  } catch (err) {
    console.error('Error saving plans to Tauri FS:', err);
  }
}
