import { readTextFile, writeTextFile, BaseDirectory, exists, mkdir } from '@tauri-apps/plugin-fs';
import { AppData, AppSettings, OrchestratorPlan } from '../types';

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
  conductorOllamaModel: '',
  conductorTaskTimeoutMinutes: 30,
};

const DEFAULT_DATA: AppData = {
  workspaces: [],
  agentGroups: [],
  taskLogs: [],
  savedPrompts: [],
  settings: DEFAULT_SETTINGS,
};

export function isTauri(): boolean {
  return typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
}

export async function loadData(): Promise<AppData> {
  if (!isTauri()) {
    const cached = localStorage.getItem('agentdeck_data');
    if (!cached) return DEFAULT_DATA;
    const parsed = JSON.parse(cached);
    // Migrate old data that still has `agents` array instead of `agentGroups`
    if (parsed.agents && !parsed.agentGroups) {
      parsed.agentGroups = [];
      delete parsed.agents;
    }
    return { ...DEFAULT_DATA, ...parsed };
  }

  try {
    await ensureDir();
    const fileExists = await exists(FILE_NAME, { baseDir: BaseDirectory.AppData });
    if (!fileExists) {
      await saveData(DEFAULT_DATA);
      return DEFAULT_DATA;
    }
    const raw = await readTextFile(FILE_NAME, { baseDir: BaseDirectory.AppData });
    const parsed = JSON.parse(raw);
    // Migrate old data
    if (parsed.agents && !parsed.agentGroups) {
      parsed.agentGroups = [];
      delete parsed.agents;
    }
    return { ...DEFAULT_DATA, ...parsed };
  } catch (err) {
    console.error('Error loading data from Tauri FS:', err);
    return DEFAULT_DATA;
  }
}

export async function saveData(data: AppData): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem('agentdeck_data', JSON.stringify(data));
    return;
  }

  try {
    await ensureDir();
    await writeTextFile(FILE_NAME, JSON.stringify(data, null, 2), {
      baseDir: BaseDirectory.AppData,
    });
  } catch (err) {
    console.error('Error saving data to Tauri FS:', err);
  }
}

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
