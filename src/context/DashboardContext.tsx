import React, { createContext, useContext, useState, useEffect } from 'react';
import { Workspace, Agent, TaskLog, SavedPrompt, AppData, AppSettings } from '../types';
import { loadData, saveData, isTauri } from '../services/storage';
import { Command } from '@tauri-apps/plugin-shell';
import { openUrl } from '@tauri-apps/plugin-opener';

export interface ToastInfo {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

export interface DashboardContextType {
  workspaces: Workspace[];
  agents: Agent[];
  taskLogs: TaskLog[];
  savedPrompts: SavedPrompt[];
  activeWorkspaceId: string | null;
  setActiveWorkspaceId: (id: string | null) => void;
  activeView: string;
  setActiveView: (view: string) => void;
  viewMode: 'grid' | 'console';
  setViewMode: (mode: 'grid' | 'console') => void;
  toast: ToastInfo | null;
  setToast: (toast: ToastInfo | null) => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  isLoaded: boolean;
  
  // Workspace CRUD
  addWorkspace: (workspace: Omit<Workspace, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateWorkspace: (id: string, updates: Partial<Workspace>) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
  
  // Agent CRUD
  addAgent: (agent: Omit<Agent, 'id'>) => Promise<void>;
  updateAgent: (id: string, updates: Partial<Agent>) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  
  // Task Log CRUD
  addTaskLog: (log: Omit<TaskLog, 'id' | 'timestamp'>) => Promise<void>;
  updateTaskLog: (id: string, updates: Partial<TaskLog>) => Promise<void>;
  deleteTaskLog: (id: string) => Promise<void>;
  
  // Prompt CRUD
  addSavedPrompt: (prompt: Omit<SavedPrompt, 'id' | 'createdAt' | 'usedAt'>) => Promise<void>;
  updateSavedPrompt: (id: string, updates: Partial<SavedPrompt>) => Promise<void>;
  deleteSavedPrompt: (id: string) => Promise<void>;
  
  // Custom functions
  copyPromptToClipboard: (promptId: string) => Promise<void>;
  launchAgent: (agentId: string) => Promise<void>;
  exportSettings: () => string;
  importSettings: (jsonData: string) => Promise<boolean>;
  settings: AppSettings;
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>;
}

const DashboardContext = createContext<DashboardContextType | undefined>(undefined);

export const DashboardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [taskLogs, setTaskLogs] = useState<TaskLog[]>([]);
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<string>('dashboard');
  const [viewMode, setViewMode] = useState<'grid' | 'console'>('grid');
  const [toast, setToast] = useState<ToastInfo | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [settings, setSettings] = useState<AppSettings>({
    shellPath: 'powershell.exe',
    ollamaHost: 'http://localhost:11434',
    openaiApiKey: '',
    anthropicApiKey: '',
  });

  // Initialize and load data from storage
  useEffect(() => {
    const initData = async () => {
      try {
        const data = await loadData();
        setWorkspaces(data.workspaces || []);
        setAgents(data.agents || []);
        setTaskLogs(data.taskLogs || []);
        setSavedPrompts(data.savedPrompts || []);
        
        if (data.workspaces && data.workspaces.length > 0) {
          setActiveWorkspaceId(data.workspaces[0].id);
        }
        if (data.settings) {
          setSettings(data.settings);
        }
        
        // Load theme from localStorage
        const savedTheme = localStorage.getItem('agentdeck_theme');
        if (savedTheme === 'light') {
          setTheme('light');
        } else {
          setTheme('dark');
        }
      } catch (err) {
        console.error('Error loading initial data', err);
      } finally {
        setIsLoaded(true);
      }
    };
    initData();
  }, []);

  // Sync theme with DOM — both the body.light class (used by Emotion selectors)
  // and the <html data-theme> attribute (used by CSS custom-property selectors).
  useEffect(() => {
    const root = window.document.body;
    if (theme === 'light') {
      root.classList.add('light');
      localStorage.setItem('agentdeck_theme', 'light');
    } else {
      root.classList.remove('light');
      localStorage.setItem('agentdeck_theme', 'dark');
    }
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const persist = async (
    updatedWorkspaces: Workspace[],
    updatedAgents: Agent[],
    updatedLogs: TaskLog[],
    updatedPrompts: SavedPrompt[],
    updatedSettings?: AppSettings
  ) => {
    const data: AppData = {
      workspaces: updatedWorkspaces,
      agents: updatedAgents,
      taskLogs: updatedLogs,
      savedPrompts: updatedPrompts,
      settings: updatedSettings || settings,
    };
    await saveData(data);
  };

  const updateSettings = async (updates: Partial<AppSettings>) => {
    const nextSettings = { ...settings, ...updates };
    setSettings(nextSettings);
    await persist(workspaces, agents, taskLogs, savedPrompts, nextSettings);
    showToast('Settings saved', 'success');
  };

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = crypto.randomUUID();
    setToast({ id, message, type });
  };

  // Clear toast automatically
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // WORKSPACE CRUD
  const addWorkspace = async (w: Omit<Workspace, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newProj: Workspace = {
      ...w,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const nextWorkspaces = [...workspaces, newProj];
    setWorkspaces(nextWorkspaces);
    
    // Auto set active workspace if none was selected
    if (!activeWorkspaceId) {
      setActiveWorkspaceId(newProj.id);
    }

    await persist(nextWorkspaces, agents, taskLogs, savedPrompts);
    showToast(`Workspace "${w.name}" created`, 'success');
  };

  const updateWorkspace = async (id: string, updates: Partial<Workspace>) => {
    const nextWorkspaces = workspaces.map(w => {
      if (w.id === id) {
        return { ...w, ...updates, updatedAt: new Date().toISOString() };
      }
      return w;
    });
    setWorkspaces(nextWorkspaces);
    await persist(nextWorkspaces, agents, taskLogs, savedPrompts);
  };

  const deleteWorkspace = async (id: string) => {
    const nextWorkspaces = workspaces.filter(w => w.id !== id);
    setWorkspaces(nextWorkspaces);
    
    // If deleted workspace was active, switch active workspace
    if (activeWorkspaceId === id) {
      setActiveWorkspaceId(nextWorkspaces.length > 0 ? nextWorkspaces[0].id : null);
    }

    // Clean up agent assignments and logs/prompts referring to this workspace
    const nextAgents = agents.map(a => 
      a.assignedWorkspaceId === id ? { ...a, assignedWorkspaceId: null } : a
    );
    setAgents(nextAgents);

    const nextLogs = taskLogs.filter(l => l.workspaceId !== id);
    setTaskLogs(nextLogs);

    const nextPrompts = savedPrompts.filter(p => p.workspaceId !== id);
    setSavedPrompts(nextPrompts);

    await persist(nextWorkspaces, nextAgents, nextLogs, nextPrompts);
    showToast('Workspace deleted and references cleared', 'info');
  };

  // AGENT CRUD
  const addAgent = async (a: Omit<Agent, 'id'>) => {
    const newAgent: Agent = {
      ...a,
      id: crypto.randomUUID(),
    };
    const nextAgents = [...agents, newAgent];
    setAgents(nextAgents);
    await persist(workspaces, nextAgents, taskLogs, savedPrompts);
    showToast(`Agent "${a.name}" registered`, 'success');
  };

  const updateAgent = async (id: string, updates: Partial<Agent>) => {
    const nextAgents = agents.map(a => {
      if (a.id === id) {
        return { ...a, ...updates };
      }
      return a;
    });
    setAgents(nextAgents);
    await persist(workspaces, nextAgents, taskLogs, savedPrompts);
  };

  const deleteAgent = async (id: string) => {
    const nextAgents = agents.filter(a => a.id !== id);
    setAgents(nextAgents);

    // Remove reference from workspaces using this agent
    const nextWorkspaces = workspaces.map(w => 
      w.agentId === id ? { ...w, agentId: null } : w
    );
    setWorkspaces(nextWorkspaces);

    await persist(nextWorkspaces, nextAgents, taskLogs, savedPrompts);
    showToast('Agent deleted', 'info');
  };

  // TASK LOG CRUD
  const addTaskLog = async (l: Omit<TaskLog, 'id' | 'timestamp'>) => {
    const newLog: TaskLog = {
      ...l,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };
    const nextLogs = [newLog, ...taskLogs]; // prepends new logs
    setTaskLogs(nextLogs);
    await persist(workspaces, agents, nextLogs, savedPrompts);
    showToast('Task log entry added', 'success');
  };

  const updateTaskLog = async (id: string, updates: Partial<TaskLog>) => {
    const nextLogs = taskLogs.map(l => {
      if (l.id === id) {
        return { ...l, ...updates };
      }
      return l;
    });
    setTaskLogs(nextLogs);
    await persist(workspaces, agents, nextLogs, savedPrompts);
  };

  const deleteTaskLog = async (id: string) => {
    const nextLogs = taskLogs.filter(l => l.id !== id);
    setTaskLogs(nextLogs);
    await persist(workspaces, agents, nextLogs, savedPrompts);
    showToast('Task log entry removed', 'info');
  };

  // PROMPT CRUD
  const addSavedPrompt = async (pr: Omit<SavedPrompt, 'id' | 'createdAt' | 'usedAt'>) => {
    const newPrompt: SavedPrompt = {
      ...pr,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      usedAt: null,
    };
    const nextPrompts = [newPrompt, ...savedPrompts];
    setSavedPrompts(nextPrompts);
    await persist(workspaces, agents, taskLogs, nextPrompts);
    showToast(`Prompt "${pr.title}" saved`, 'success');
  };

  const updateSavedPrompt = async (id: string, updates: Partial<SavedPrompt>) => {
    const nextPrompts = savedPrompts.map(p => {
      if (p.id === id) {
        return { ...p, ...updates };
      }
      return p;
    });
    setSavedPrompts(nextPrompts);
    await persist(workspaces, agents, taskLogs, nextPrompts);
  };

  const deleteSavedPrompt = async (id: string) => {
    const nextPrompts = savedPrompts.filter(p => p.id !== id);
    setSavedPrompts(nextPrompts);
    await persist(workspaces, agents, taskLogs, nextPrompts);
    showToast('Prompt removed', 'info');
  };

  // CUSTOM FUNCTIONS
  const copyPromptToClipboard = async (promptId: string) => {
    const pr = savedPrompts.find(p => p.id === promptId);
    if (!pr) {
      showToast('Prompt not found', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(pr.content);
      
      // Update usedAt timestamp
      const nextPrompts = savedPrompts.map(p => {
        if (p.id === promptId) {
          return { ...p, usedAt: new Date().toISOString() };
        }
        return p;
      });
      setSavedPrompts(nextPrompts);
      await persist(workspaces, agents, taskLogs, nextPrompts);
      showToast('Prompt copied to clipboard!', 'success');
    } catch (err) {
      console.error('Failed to copy prompt to clipboard:', err);
      showToast('Failed to copy to clipboard', 'error');
    }
  };

  const launchAgent = async (agentId: string) => {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) {
      showToast('Agent not found', 'error');
      return;
    }
    
    // Tauri execution wrapper
    if (!isTauri()) {
      showToast(`[Mock] Launching ${agent.name} (Non-Tauri Mode)`, 'info');
      return;
    }

    if (agent.type === 'terminal') {
      const command = agent.launchCommand;
      if (!command) {
        showToast('No launch command configured for this agent', 'error');
        return;
      }
      try {
        showToast(`Launching terminal command for ${agent.name}...`, 'info');
        const shellExe = settings.shellPath || 'cmd.exe';
        const cmd = Command.create('run-cmd', ['/c', `start ${shellExe} /k ${command}`]);
        await cmd.execute();
        showToast(`Terminal window opened for ${agent.name}`, 'success');
      } catch (err: any) {
        console.error('Failed to execute command via Tauri shell plugin:', err);
        showToast(`Launch failed: ${err.message || err}`, 'error');
      }
    } else if (agent.type === 'web') {
      const url = agent.launchUrl;
      if (!url) {
        showToast('No launch URL configured for this agent', 'error');
        return;
      }
      try {
        showToast(`Opening browser for ${agent.name}...`, 'info');
        await openUrl(url);
        showToast(`Opened browser successfully`, 'success');
      } catch (err: any) {
        console.error('Failed to open URL via Tauri opener plugin:', err);
        showToast(`Failed to open URL: ${err.message || err}`, 'error');
      }
    } else {
      showToast(`Launching ${agent.name} is not configured`, 'info');
    }
  };

  const exportSettings = (): string => {
    // Strip sensitive API keys so they are never leaked via export.
    const safeSettings = {
      ...settings,
      openaiApiKey: '',
      anthropicApiKey: '',
    };
    const data: AppData = {
      workspaces,
      agents,
      taskLogs,
      savedPrompts,
      settings: safeSettings,
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
      
      // Structural validation — filter out malformed items to prevent crashes.
      const isObj = (v: any) => v !== null && typeof v === 'object';
      const importedWorkspaces = Array.isArray(parsed.workspaces)
        ? parsed.workspaces.filter((w: any) => isObj(w) && typeof w.id === 'string' && typeof w.name === 'string')
        : [];
      const importedAgents = Array.isArray(parsed.agents)
        ? parsed.agents.filter((a: any) => isObj(a) && typeof a.id === 'string' && typeof a.name === 'string')
        : [];
      const importedLogs = Array.isArray(parsed.taskLogs)
        ? parsed.taskLogs.filter((l: any) => isObj(l) && typeof l.id === 'string' && typeof l.summary === 'string')
        : [];
      const importedPrompts = Array.isArray(parsed.savedPrompts)
        ? parsed.savedPrompts.filter((p: any) => isObj(p) && typeof p.id === 'string' && typeof p.title === 'string')
        : [];
      const importedSettings = isObj(parsed.settings) ? { ...settings, ...parsed.settings } : settings;
      
      setWorkspaces(importedWorkspaces);
      setAgents(importedAgents);
      setTaskLogs(importedLogs);
      setSavedPrompts(importedPrompts);
      setSettings(importedSettings);
      
      if (importedWorkspaces.length > 0) {
        setActiveWorkspaceId(importedWorkspaces[0].id);
      } else {
        setActiveWorkspaceId(null);
      }

      await persist(importedWorkspaces, importedAgents, importedLogs, importedPrompts, importedSettings);
      showToast('Settings imported successfully!', 'success');
      return true;
    } catch (err) {
      console.error('Import error:', err);
      showToast('Failed to parse settings JSON', 'error');
      return false;
    }
  };

  return (
    <DashboardContext.Provider value={{
      workspaces,
      agents,
      taskLogs,
      savedPrompts,
      activeWorkspaceId,
      setActiveWorkspaceId,
      activeView,
      setActiveView,
      toast,
      setToast,
      showToast,
      theme,
      toggleTheme,
      isLoaded,
      addWorkspace,
      updateWorkspace,
      deleteWorkspace,
      addAgent,
      updateAgent,
      deleteAgent,
      addTaskLog,
      updateTaskLog,
      deleteTaskLog,
      addSavedPrompt,
      updateSavedPrompt,
      deleteSavedPrompt,
      copyPromptToClipboard,
      launchAgent,
      exportSettings,
      importSettings,
      settings,
      updateSettings,
      viewMode,
      setViewMode,
    }}>
      {children}
    </DashboardContext.Provider>
  );
};

export const useDashboard = () => {
  const context = useContext(DashboardContext);
  if (context === undefined) {
    throw new Error('useDashboard must be used within a DashboardProvider');
  }
  return context;
};
