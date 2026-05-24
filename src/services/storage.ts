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
  spaces: [],
  taskLogs: [],
  savedPrompts: [],
  settings: DEFAULT_SETTINGS,
};

export function isTauri(): boolean {
  return typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
}

/** Migrate old persisted data shapes to the current schema. */
function migrate(parsed: any): AppData {
  // agents → removed (pre-Space era)
  if (parsed.agents) delete parsed.agents;
  // agentGroups → spaces
  if (parsed.agentGroups && !parsed.spaces) {
    parsed.spaces = parsed.agentGroups;
    delete parsed.agentGroups;
  }
  // groupId → spaceId on taskLogs
  if (Array.isArray(parsed.taskLogs)) {
    parsed.taskLogs = parsed.taskLogs.map((l: any) => {
      if ('groupId' in l && !('spaceId' in l)) {
        const { groupId, ...rest } = l;
        return { ...rest, spaceId: groupId };
      }
      return l;
    });
  }
  // groupId → spaceId on savedPrompts
  if (Array.isArray(parsed.savedPrompts)) {
    parsed.savedPrompts = parsed.savedPrompts.map((p: any) => {
      if ('groupId' in p && !('spaceId' in p)) {
        const { groupId, ...rest } = p;
        return { ...rest, spaceId: groupId };
      }
      return p;
    });
  }
  return { ...DEFAULT_DATA, ...parsed };
}

export async function loadData(): Promise<AppData> {
  if (!isTauri()) {
    const cached = localStorage.getItem('agentdeck_data');
    if (!cached) return DEFAULT_DATA;
    return migrate(JSON.parse(cached));
  }

  try {
    await ensureDir();
    const fileExists = await exists(FILE_NAME, { baseDir: BaseDirectory.AppData });
    if (!fileExists) {
      await saveData(DEFAULT_DATA);
      return DEFAULT_DATA;
    }
    const raw = await readTextFile(FILE_NAME, { baseDir: BaseDirectory.AppData });
    return migrate(JSON.parse(raw));
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
    if (!cached) return [];
    // Migrate groupId → spaceId on plans
    const plans = JSON.parse(cached);
    return plans.map((p: any) => {
      if ('groupId' in p && !('spaceId' in p)) {
        const { groupId, ...rest } = p;
        return { ...rest, spaceId: groupId };
      }
      return p;
    });
  }

  try {
    await ensureDir();
    const fileExists = await exists(PLANS_FILE_NAME, { baseDir: BaseDirectory.AppData });
    if (!fileExists) return [];
    const raw = await readTextFile(PLANS_FILE_NAME, { baseDir: BaseDirectory.AppData });
    const plans = JSON.parse(raw);
    return plans.map((p: any) => {
      if ('groupId' in p && !('spaceId' in p)) {
        const { groupId, ...rest } = p;
        return { ...rest, spaceId: groupId };
      }
      return p;
    });
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
