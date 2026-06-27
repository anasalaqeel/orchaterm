import React, { useState, useRef, useEffect } from 'react';
import { css, cx } from '@emotion/css';
import { motion, AnimatePresence } from 'motion/react';
import { invoke } from '@tauri-apps/api/core';
import { useDashboard } from '../context/DashboardContext';
import { Workspace } from '../types';
import { DEFAULT_TERMINAL_CONFIG, TERMINAL_THEME_PRESETS } from '../utils/terminalThemes';
import type { TerminalConfig, TerminalKeybinding } from '../types';
import { ConfirmDialog, Input, Select } from '../components/ui';
import { createProvider } from '../services/llm';
import type { ProviderConfig, UseCaseProviders } from '../services/llm/types';
import {
  Sun,
  Moon,
  Download,
  Upload,
  Trash2,
  Edit2,
  RefreshCw,
  Network,
  Terminal,
} from 'lucide-react';

// ── Terminal tab helpers ────────────────────────────────────────────────────

interface ShellInfo {
  name: string;
  path: string;
  args: string[];
}

const FALLBACK_SHELLS: ShellInfo[] = navigator.userAgent.toLowerCase().includes('win')
  ? [
      { name: 'PowerShell',     path: 'powershell.exe', args: [] },
      { name: 'Command Prompt', path: 'cmd.exe',        args: [] },
      { name: 'WSL',            path: 'wsl',            args: [] },
      { name: 'Git Bash',       path: 'bash',           args: [] },
    ]
  : [
      { name: 'zsh',  path: '/bin/zsh',  args: [] },
      { name: 'bash', path: '/bin/bash', args: [] },
      { name: 'sh',   path: '/bin/sh',   args: [] },
    ];

function shellDisplayName(path: string, shells: ShellInfo[]): string {
  const match = shells.find(s => s.path === path);
  if (match) return match.name;
  // strip directory and extension for custom paths
  return path.replace(/\\/g, '/').split('/').pop()?.replace(/\.(exe|cmd|bat|sh)$/i, '') ?? path;
}

// ── LLM Provider editor ──────────────────────────────────────────────────────

type ProviderPreset = { label: string; config: Omit<ProviderConfig, 'model'> };

const PROVIDER_PRESETS: ProviderPreset[] = [
  { label: 'Ollama (local)',         config: { provider: 'ollama',            baseUrl: 'http://localhost:11434' } },
  { label: 'LM Studio (local)',      config: { provider: 'openai-compatible', baseUrl: 'http://localhost:1234' } },
  { label: 'OpenAI',                 config: { provider: 'openai-compatible', baseUrl: 'https://api.openai.com' } },
  { label: 'DeepSeek',               config: { provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com' } },
  { label: 'Together.ai',            config: { provider: 'openai-compatible', baseUrl: 'https://api.together.xyz' } },
  { label: 'Anthropic',              config: { provider: 'anthropic',         baseUrl: 'https://api.anthropic.com' } },
  { label: 'Google Gemini',          config: { provider: 'gemini',            baseUrl: 'https://generativelanguage.googleapis.com' } },
  { label: 'Custom (OpenAI-compat)', config: { provider: 'openai-compatible', baseUrl: '' } },
];

const USE_CASE_LABELS: Record<keyof UseCaseProviders, string> = {
  relay:      'Relay (task handoff)',
  planGen:    'Plan Generation',
  autoAnswer: 'Auto-Answer',
  chat:       'Chat',
  routing:    'Routing',
};

interface ProviderConfigEditorProps {
  label: string;
  value: ProviderConfig;
  onChange: (cfg: ProviderConfig) => void;
  providerApiKeys: Record<string, string>;
  onKeyChange: (providerKey: string, apiKey: string) => void;
}

const providerKey = (cfg: Pick<ProviderConfig, 'provider' | 'baseUrl'>) =>
  `${cfg.provider}:${cfg.baseUrl ?? ''}`;

const ProviderConfigEditor: React.FC<ProviderConfigEditorProps> = ({ label, value, onChange, providerApiKeys, onKeyChange }) => {
  const [models, setModels] = React.useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = React.useState(false);
  const [modelsError, setModelsError] = React.useState<string | null>(null);
  const [testStatus, setTestStatus] = React.useState<'idle' | 'ok' | 'fail'>('idle');

  const currentPreset = PROVIDER_PRESETS.find(
    p => p.config.provider === value.provider && p.config.baseUrl === value.baseUrl,
  );

  const handlePresetChange = (presetLabel: string) => {
    const preset = PROVIDER_PRESETS.find(p => p.label === presetLabel);
    if (!preset) return;
    onKeyChange(providerKey(value), value.apiKey ?? '');
    const providerChanged = preset.config.provider !== value.provider;
    const restoredKey = providerApiKeys[providerKey(preset.config)] ?? '';
    onChange({ ...value, ...preset.config, apiKey: restoredKey, model: providerChanged ? '' : value.model });
  };

  const needsApiKey = value.provider !== 'ollama' && value.baseUrl !== 'http://localhost:1234';
  const needsBaseUrl = value.provider === 'ollama' || value.provider === 'openai-compatible';

  const fetchModels = async () => {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const provider = createProvider(value);
      const list = await provider.listModels();
      setModels(list);
      if (list.length > 0 && !list.includes(value.model)) {
        onChange({ ...value, model: list[0] });
      }
    } catch (err: any) {
      setModels([]);
      setModelsError(err?.message ?? 'Failed to fetch models');
    }
    finally { setModelsLoading(false); }
  };

  React.useEffect(() => {
    if (needsApiKey && !value.apiKey) return;
    fetchModels();
  }, [value.provider, value.baseUrl, value.apiKey]);

  const handleRefreshModels = fetchModels;

  const handleTest = async () => {
    try {
      const provider = createProvider(value);
      const ok = await provider.checkOnline();
      setTestStatus(ok ? 'ok' : 'fail');
    } catch { setTestStatus('fail'); }
    setTimeout(() => setTestStatus('idle'), 3000);
  };

  const editorStyles = {
    wrapper: css`display:flex;flex-direction:column;gap:8px;padding:12px 0;border-bottom:1px solid var(--border-color);`,
    sectionLabel: css`font-weight:600;font-size:13px;color:var(--text-primary);`,
    fieldLabel: css`font-size:11px;font-weight:600;color:var(--text-secondary);display:block;margin-bottom:4px;`,
    modelRow: css`display:flex;gap:6px;align-items:flex-end;`,
    iconBtn: css`
      background-color:var(--bg-tertiary);border:1px solid var(--border-color);
      border-radius:var(--border-radius-sm);padding:7px 8px;cursor:pointer;
      color:var(--text-secondary);display:flex;align-items:center;justify-content:center;
      transition:color 0.15s,background-color 0.15s;font-size:13px;line-height:1;
      &:hover:not(:disabled){color:var(--text-primary);background-color:var(--bg-hover);}
      &:disabled{opacity:0.4;cursor:not-allowed;}
    `,
  };

  return (
    <div className={editorStyles.wrapper}>
      <div className={editorStyles.sectionLabel}>{label}</div>

      <Select
        label="Provider"
        value={currentPreset?.label ?? 'Custom (OpenAI-compat)'}
        onChange={handlePresetChange}
        options={PROVIDER_PRESETS.map(p => ({ value: p.label, name: p.label }))}
      />

      {needsBaseUrl && (
        <div>
          <label className={editorStyles.fieldLabel}>Base URL</label>
          <Input
            type="text"
            className={providerInputStyle}
            value={value.baseUrl ?? ''}
            onChange={e => onChange({ ...value, baseUrl: e.target.value })}
            placeholder="http://localhost:11434"
          />
        </div>
      )}

      {needsApiKey && (
        <div>
          <label className={editorStyles.fieldLabel}>API Key</label>
          <Input
            type="password"
            className={providerInputStyle}
            value={value.apiKey ?? ''}
            onChange={e => {
              onKeyChange(providerKey(value), e.target.value);
              onChange({ ...value, apiKey: e.target.value });
            }}
            placeholder="sk-..."
          />
        </div>
      )}

      {needsApiKey && !value.apiKey ? (
        <div>
          <label className={editorStyles.fieldLabel}>Model</label>
          <div className={css`font-size:11px;color:var(--text-secondary);padding:8px;background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:var(--border-radius-sm);`}>
            Enter an API key above to load available models.
          </div>
        </div>
      ) : (
        <>
          <div className={editorStyles.modelRow}>
            <div style={{ flex: 1 }}>
              {models.length > 0 ? (
                <Select
                  label="Model"
                  value={value.model}
                  onChange={m => onChange({ ...value, model: m })}
                  options={models.map(m => ({ value: m, name: m }))}
                />
              ) : (
                <div>
                  <label className={editorStyles.fieldLabel}>Model</label>
                  <Input
                    type="text"
                    className={providerInputStyle}
                    value={value.model}
                    onChange={e => onChange({ ...value, model: e.target.value })}
                    placeholder="e.g. llama3.2"
                  />
                </div>
              )}
            </div>
            <button type="button" className={editorStyles.iconBtn} onClick={handleRefreshModels} disabled={modelsLoading} title="Fetch model list">
              <RefreshCw className={cx(css`width:14px;height:14px;`, modelsLoading && css`animation:spin 1s linear infinite;@keyframes spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}`)} />
            </button>
            <button
              type="button"
              className={editorStyles.iconBtn}
              onClick={handleTest}
              title="Test connection"
              style={{ color: testStatus === 'ok' ? 'var(--color-success)' : testStatus === 'fail' ? 'var(--color-error)' : undefined }}
            >
              {testStatus === 'idle' ? '⚡' : testStatus === 'ok' ? '✓' : '✗'}
            </button>
          </div>
          {modelsError && (
            <div className={css`font-size:11px;color:var(--color-error);margin-top:4px;`}>
              ⚠ {modelsError}
            </div>
          )}
        </>
      )}
    </div>
  );
};

const providerInputStyle = css`
  width:100%;background-color:var(--bg-input);border:1px solid var(--border-color);
  border-radius:var(--border-radius-sm);padding:8px;font-size:var(--font-size-xs);
  color:var(--text-primary);outline:none;transition:all 0.15s ease-in-out;
  &:focus{border-color:var(--color-brand);box-shadow:0 0 0 1px var(--color-brand);}
`;

const fieldLabelStyle = css`
  font-size:11px;font-weight:600;color:var(--text-secondary);display:block;margin-bottom:4px;
`;

export const SettingsView: React.FC = () => {
  const {
    workspaces,
    theme,
    toggleTheme,
    exportSettings,
    importSettings,
    updateWorkspace,
    deleteWorkspace,
    showToast,
    settings,
    updateSettings
  } = useDashboard();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [llmProviders, setLlmProviders] = useState<UseCaseProviders>(settings.llmProviders);
  const [llmProviderMode, setLlmProviderMode] = useState<'simple' | 'advanced'>(settings.llmProviderMode ?? 'advanced');
  const [simpleLlmProvider, setSimpleLlmProvider] = useState<ProviderConfig>(settings.simpleLlmProvider ?? { provider: 'ollama', model: 'llama3.2', baseUrl: 'http://localhost:11434' });
  const [providerApiKeys, setProviderApiKeys] = useState<Record<string, string>>(settings.providerApiKeys ?? {});
  const [conductorTaskTimeoutMinutes, setConductorTaskTimeoutMinutes] = useState(
    settings.conductorTaskTimeoutMinutes
  );
  const [conductorInteractionMode, setConductorInteractionMode] = useState<'auto' | 'manual'>(
    settings.conductorInteractionMode ?? 'auto'
  );

  /** When the AI master switch is off, AI-dependent settings render dimmed + inert. */
  const aiDisabled = settings.aiEnabled === false;

  // Terminal settings state
  const [detectedShells, setDetectedShells] = useState<ShellInfo[]>([]);
  const [defaultShell, setDefaultShell]     = useState<string>(settings.shellPath || '');
  const [shellsLoading, setShellsLoading]   = useState(false);
  const [shellsError, setShellsError]       = useState('');
  const [useCustomPath, setUseCustomPath]   = useState(false);
  const [customShellPath, setCustomShellPath] = useState('');
  const shellsFetchedRef = React.useRef(false);

  const [terminalConfig, setTerminalConfig] = useState<TerminalConfig>(
    settings.terminalConfig ?? DEFAULT_TERMINAL_CONFIG
  );
  const [newBinding, setNewBinding] = useState<TerminalKeybinding>({
    key: '', action: 'clear', text: '',
  });
  const [showCustomColors, setShowCustomColors] = useState(false);

  useEffect(() => {
    setLlmProviders(settings.llmProviders);
    setLlmProviderMode(settings.llmProviderMode ?? 'advanced');
    if (settings.simpleLlmProvider) setSimpleLlmProvider(settings.simpleLlmProvider);
    setProviderApiKeys(settings.providerApiKeys ?? {});
    setConductorTaskTimeoutMinutes(settings.conductorTaskTimeoutMinutes);
    setConductorInteractionMode(settings.conductorInteractionMode ?? 'auto');
    setTerminalConfig(settings.terminalConfig ?? DEFAULT_TERMINAL_CONFIG);
    if (!useCustomPath) {
      setDefaultShell(settings.shellPath || '');
    }
  }, [settings, useCustomPath]);

  const handleSaveIntegrations = () => {
    updateSettings({ llmProviders, llmProviderMode, simpleLlmProvider, providerApiKeys, conductorTaskTimeoutMinutes, conductorInteractionMode });
  };

  // Confirm delete dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState('');
  const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);

  // Tabs for settings sections
  const [activeTab, setActiveTab] = useState<'general' | 'projects' | 'terminal'>('general');

  useEffect(() => {
    if (activeTab !== 'terminal') return;
    if (shellsFetchedRef.current) return; // fetch only once per mount
    shellsFetchedRef.current = true;
    setShellsLoading(true);
    setShellsError('');
    invoke<ShellInfo[]>('get_available_shells')
      .then((shells) => {
        if (shells.length === 0) throw new Error('empty');
        setDetectedShells(shells);
        // Pre-select the shell that matches settings.shellPath
        const saved = settings.shellPath || '';
        const match = saved
          ? shells.find(
              s => s.path === saved ||
                s.name.toLowerCase().includes(
                  (saved.replace(/\\/g, '/').split('/').pop()?.replace(/\.(exe|cmd|bat|sh)$/i, '') ?? saved).toLowerCase()
                )
            )
          : null;
        setDefaultShell(match?.path ?? shells[0].path);
      })
      .catch(() => {
        setShellsError('Could not detect shells — using common defaults');
        setDetectedShells(FALLBACK_SHELLS);
        const saved = settings.shellPath || '';
        const match = saved ? FALLBACK_SHELLS.find(s => s.path === saved) : null;
        setDefaultShell(match?.path ?? saved ?? FALLBACK_SHELLS[0]?.path ?? '');
      })
      .finally(() => setShellsLoading(false));
  }, [activeTab, settings.shellPath]);

  // Modals / forms state
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null);

  // New/Edit Workspace Form State
  const [projName, setProjName] = useState('');
  const [projPath, setProjPath] = useState('');
  const [projDesc, setProjDesc] = useState('');
  const [projColor, setProjColor] = useState('#3b82f6');
  const [projStatus, setProjStatus] = useState<'active' | 'paused' | 'idle'>('active');

  // Export Settings Handler
  const handleExport = () => {
    try {
      const dataStr = exportSettings();
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `orchaterm_backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      showToast('Settings exported successfully', 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to export settings', 'error');
    }
  };

  // Import Settings Handler
  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      if (text) {
        const success = await importSettings(text);
        if (success) {
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      }
    };
    reader.readAsText(file);
  };

  // WORKSPACE CRUD
  const handleEditWorkspaceClick = (w: Workspace) => {
    setEditingWorkspace(w);
    setProjName(w.name);
    setProjPath(w.path || '');
    setProjDesc(w.description);
    setProjColor(w.color);
    setProjStatus(w.status);
  };

  const handleUpdateWorkspaceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWorkspace) return;
    if (!projName.trim()) {
      showToast('Workspace name is required', 'error');
      return;
    }

    updateWorkspace(editingWorkspace.id, {
      name: projName,
      path: projPath,
      description: projDesc,
      color: projColor,
      status: projStatus,
    });

    setEditingWorkspace(null);
    setProjName('');
    setProjPath('');
    setProjDesc('');
    showToast('Workspace updated successfully', 'success');
  };

  return (
    <div className={styles.container}>
      
      {/* Header */}
      <div>
        <h2 className={styles.title}>System Settings</h2>
        <p className={styles.description}>Control data persistence, manage configuration resources, and UI modes.</p>
      </div>

      {/* Tabs */}
      <div className={styles.tabsContainer}>
        <button
          onClick={() => setActiveTab('general')}
          className={cx(
            styles.tabButton,
            activeTab === 'general' ? styles.tabButtonActive : styles.tabButtonInactive
          )}
        >
          General & Backups
          {activeTab === 'general' && <span className={styles.tabActiveLine} />}
        </button>
        <button
          onClick={() => setActiveTab('projects')}
          className={cx(
            styles.tabButton,
            activeTab === 'projects' ? styles.tabButtonActive : styles.tabButtonInactive
          )}
        >
          Workspaces ({workspaces.length})
          {activeTab === 'projects' && <span className={styles.tabActiveLine} />}
        </button>
        <button
          onClick={() => setActiveTab('terminal')}
          className={cx(
            styles.tabButton,
            activeTab === 'terminal' ? styles.tabButtonActive : styles.tabButtonInactive
          )}
        >
          Terminal
          {activeTab === 'terminal' && <span className={styles.tabActiveLine} />}
        </button>
      </div>

      {/* GENERAL & BACKUPS TAB */}
      {activeTab === 'general' && (
        <div className={styles.tabContentContainer}>
          {/* Theme card */}
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>
              <Sun className={cx(styles.cardTitleIcon, styles.sunIcon)} />
              <span>Appearance Mode</span>
            </h3>
            <p className={styles.cardDescription}>
              Toggle between a developer dark theme and standard daylight theme.
            </p>
            <div className={styles.flexCenterGap3}>
              <button
                onClick={toggleTheme}
                className={styles.themeToggleButton}
              >
                {theme === 'dark' ? (
                  <>
                    <Sun className={cx(styles.themeToggleIcon, styles.sunIconYellow)} />
                    <span>Switch to Light Theme</span>
                  </>
                ) : (
                  <>
                    <Moon className={cx(styles.themeToggleIcon, styles.moonIconBlue)} />
                    <span>Switch to Dark Theme</span>
                  </>
                )}
              </button>
              <span className={styles.currentThemeBadge}>
                Current: {theme}
              </span>
            </div>
          </div>

          {/* Backup card */}
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>
              <Download className={cx(styles.cardTitleIcon, styles.downloadIcon)} />
              <span>Import & Export Data</span>
            </h3>
            <p className={styles.cardDescription}>
              Back up your entire state including project workspaces, custom developer agents, prompt catalogs, and process logs. You can import this JSON file into any local instance.
            </p>
            <div className={styles.flexWrapGap3}>
              <button
                onClick={handleExport}
                className={styles.primaryButton}
              >
                <Download className={styles.btnIcon} />
                <span>Export Configuration JSON</span>
              </button>

              <button
                onClick={handleImportClick}
                className={styles.secondaryButton}
              >
                <Upload className={styles.btnIcon} />
                <span>Import Configuration JSON</span>
              </button>
              
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleImportFileChange}
                className={styles.hidden}
              />
            </div>
          </div>

          {/* AI master switch — primary control governing every AI feature below */}
          <div className={styles.integrationsCard}>
            <div className={css`display: flex; align-items: center; justify-content: space-between; gap: 16px;`}>
              <div>
                <h3 className={cx(styles.cardTitle, css`margin-bottom: 6px;`)}>
                  <span style={{ fontSize: 18, lineHeight: 1 }}>✨</span>
                  <span>AI Features</span>
                </h3>
                <p className={cx(styles.cardDescription, css`margin: 0;`)}>
                  Master switch for live feed, auto-relay, session continuation, and chat.
                  Turn it off to use Orchaterm as a plain terminal — no LLM calls are made.
                </p>
              </div>
              <button
                type="button"
                aria-label="Toggle AI features"
                onClick={() => updateSettings({ aiEnabled: !(settings.aiEnabled !== false) })}
                className={css`
                  position: relative;
                  width: 44px; height: 24px;
                  border-radius: 12px;
                  border: none; cursor: pointer;
                  flex-shrink: 0;
                  background: ${(settings.aiEnabled !== false) ? 'var(--color-brand)' : 'var(--bg-tertiary)'};
                  transition: background 0.2s;
                  &::after {
                    content: '';
                    position: absolute;
                    top: 3px;
                    left: ${(settings.aiEnabled !== false) ? '23px' : '3px'};
                    width: 18px; height: 18px;
                    border-radius: 50%;
                    background: white;
                    transition: left 0.2s;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.3);
                  }
                `}
              />
            </div>
          </div>

          {/* LLM Providers card */}
          <div className={cx(styles.integrationsCard, aiDisabled && styles.aiDisabledSection)}>
            <h3 className={styles.cardTitle}>
              <Network className={cx(styles.cardTitleIcon, styles.settingsIcon)} />
              <span>LLM Providers</span>
            </h3>
            <p className={styles.cardDescription}>
              Configure the AI model for each orchestration use case. Supports Ollama, LM Studio,
              OpenAI, DeepSeek, Together.ai, Anthropic, and Gemini.
            </p>

            <div className={css`
              display: inline-flex;
              width: fit-content;
              align-self: flex-start;
              background-color: var(--bg-tertiary);
              padding: 4px;
              border-radius: 8px;
              gap: 4px;
              margin-bottom: 16px;
              border: 1px solid var(--border-color);
              box-shadow: 0 1px 2px rgba(0,0,0,0.05) inset;
            `}>
              {(['simple', 'advanced'] as const).map(mode => {
                const isActive = llmProviderMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setLlmProviderMode(mode)}
                    className={css`
                      position: relative;
                      padding: 8px 20px;
                      border-radius: 6px;
                      font-size: 13px;
                      font-weight: 500;
                      cursor: pointer;
                      border: none;
                      background: transparent;
                      color: ${isActive ? '#fff' : 'var(--text-secondary)'};
                      transition: color 0.2s ease;
                      z-index: 1;
                      &:hover { color: ${isActive ? '#fff' : 'var(--text-primary)'}; }
                    `}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="llmModeToggleBg"
                        className={css`
                          position: absolute;
                          inset: 0;
                          background-color: #7b68ee;
                          border-radius: 6px;
                          z-index: -1;
                          box-shadow: 0 1px 3px rgba(123,104,238,0.4);
                        `}
                        transition={{ type: 'spring', bounce: 0.15, duration: 0.5 }}
                      />
                    )}
                    <span style={{ position: 'relative', zIndex: 2 }}>
                      {mode === 'simple' ? '✨ Simple Mode (Global)' : '⚙️ Advanced Mode (Per Use-Case)'}
                    </span>
                  </button>
                );
              })}
            </div>

            <AnimatePresence mode="wait">
              {llmProviderMode === 'simple' ? (
                <motion.div
                  key="simple"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  <ProviderConfigEditor
                    label="Global Provider Settings (Applies to all use cases)"
                    value={simpleLlmProvider}
                    onChange={setSimpleLlmProvider}
                    providerApiKeys={providerApiKeys}
                    onKeyChange={(k, v) => setProviderApiKeys(prev => ({ ...prev, [k]: v }))}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="advanced"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  {(Object.keys(USE_CASE_LABELS) as Array<keyof UseCaseProviders>).map(key => (
                    <ProviderConfigEditor
                      key={key}
                      label={USE_CASE_LABELS[key]}
                      value={llmProviders[key]}
                      onChange={cfg => setLlmProviders(prev => ({ ...prev, [key]: cfg }))}
                      providerApiKeys={providerApiKeys}
                      onKeyChange={(k, v) => setProviderApiKeys(prev => ({ ...prev, [k]: v }))}
                    />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Session Continuation ───────────────────────────────────────────────── */}
            <div className={css`margin-top: 32px;`}>
              <h3 className={css`
                font-size: 13px;
                font-weight: 600;
                color: var(--text-secondary);
                text-transform: uppercase;
                letter-spacing: 0.08em;
                margin-bottom: 16px;
              `}>
                Session Continuation
              </h3>

              {/* Enable toggle */}
              <div className={css`display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;`}>
                <div>
                  <div className={css`font-size: 13px; color: var(--text-primary);`}>Enable session continuation</div>
                  <div className={css`font-size: 12px; color: var(--text-tertiary); margin-top: 2px;`}>
                    Detect when agents hit token limits and generate resume checkpoints
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    updateSettings({
                      continuation: {
                        ...(settings.continuation ?? { targetSessionId: null, mode: 'semi', snapshotIntervalChars: 4000 }),
                        enabled: !(settings.continuation?.enabled ?? false),
                      },
                    })
                  }
                  className={css`
                    position: relative;
                    width: 44px; height: 24px;
                    border-radius: 12px;
                    border: none; cursor: pointer;
                    background: ${(settings.continuation?.enabled ?? false) ? 'var(--color-brand)' : 'var(--bg-tertiary)'};
                    transition: background 0.2s;
                    flex-shrink: 0;
                    &::after {
                      content: '';
                      position: absolute;
                      top: 3px;
                      left: ${(settings.continuation?.enabled ?? false) ? '23px' : '3px'};
                      width: 18px; height: 18px;
                      border-radius: 50%;
                      background: white;
                      transition: left 0.2s;
                      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
                    }
                  `}
                />
              </div>

              {/* Mode selector */}
              <div className={css`margin-bottom: 16px;`}>
                <label className={fieldLabelStyle}>Resume mode</label>
                <Select
                  value={settings.continuation?.mode ?? 'semi'}
                  onChange={v =>
                    updateSettings({
                      continuation: {
                        ...(settings.continuation ?? { enabled: false, targetSessionId: null, snapshotIntervalChars: 4000 }),
                        mode: v as 'auto' | 'semi' | 'file-only',
                      },
                    })
                  }
                  options={[
                    { value: 'auto',      name: 'Auto — inject immediately (falls back to modal if no target set)' },
                    { value: 'semi',      name: 'Semi-automatic — show modal to confirm injection' },
                    { value: 'file-only', name: 'File only — save checkpoint, no injection' },
                  ]}
                />
              </div>

              {/* Snapshot interval */}
              <div className={css`margin-bottom: 16px;`}>
                <label className={fieldLabelStyle}>Periodic snapshot interval (chars)</label>
                <Input
                  type="number"
                  className={providerInputStyle}
                  value={String(settings.continuation?.snapshotIntervalChars ?? 4000)}
                  min={500}
                  onChange={e => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v) && v >= 500) {
                      updateSettings({
                        continuation: {
                          ...(settings.continuation ?? { enabled: false, targetSessionId: null, mode: 'semi' }),
                          snapshotIntervalChars: v,
                        },
                      });
                    }
                  }}
                />
                <div className={css`font-size: 11px; color: var(--text-tertiary); margin-top: 4px;`}>
                  A progress snapshot is written every N new buffer characters. Minimum: 500.
                </div>
              </div>

              {/* Max context window */}
              <div className={css`margin-bottom: 16px;`}>
                <label className={fieldLabelStyle}>Checkpoint history sent to LLM (chars)</label>
                <Input
                  type="number"
                  className={providerInputStyle}
                  value={String(settings.continuation?.maxContextChars ?? 20000)}
                  min={1000}
                  onChange={e => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v) && v >= 1000) {
                      updateSettings({
                        continuation: {
                          ...(settings.continuation ?? { enabled: false, targetSessionId: null, mode: 'semi', snapshotIntervalChars: 4000 }),
                          maxContextChars: v,
                        },
                      });
                    }
                  }}
                />
                <div className={css`font-size: 11px; color: var(--text-tertiary); margin-top: 4px;`}>
                  Limits the terminal output history buffer sent to the LLM when generating a handoff checkpoint file to prevent slow processing times. Minimum: 1000.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, paddingTop: 8, flexWrap: 'wrap' }}>
              <div>
                <label className={styles.formLabel}>Agent Interaction</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['auto', 'manual'] as const).map(mode => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setConductorInteractionMode(mode)}
                      className={css`
                        padding: 4px 14px; border-radius: 4px; font-size: 12px; cursor: pointer;
                        border: 1px solid ${conductorInteractionMode === mode ? '#7b68ee' : 'var(--border-color)'};
                        background: ${conductorInteractionMode === mode ? '#7b68ee22' : 'transparent'};
                        color: ${conductorInteractionMode === mode ? '#7b68ee' : 'var(--text-secondary)'};
                        &:hover { border-color: #7b68ee; }
                      `}
                    >
                      {mode === 'auto' ? '🤖 Auto' : '👤 Manual'}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>
                  {conductorInteractionMode === 'auto'
                    ? 'LLM answers agent prompts automatically'
                    : 'You must INJECT answers to agent prompts'}
                </div>
              </div>
              <div>
                <label className={styles.formLabel}>Task Timeout (minutes, 0 = off)</label>
                <Input
                  type="number" min={0} max={480}
                  className={styles.integrationInput}
                  value={conductorTaskTimeoutMinutes}
                  onChange={e => setConductorTaskTimeoutMinutes(Number(e.target.value))}
                  style={{ width: 100 }}
                />
              </div>
              <div style={{ flex: 1 }} />
              <button type="button" className={styles.amberButton} onClick={handleSaveIntegrations}>
                Save Provider Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WORKSPACES MANAGEMENT TAB */}
      {activeTab === 'projects' && (
        <div>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr className={styles.thRow}>
                  <th className={styles.thW12}>Tag</th>
                  <th className={styles.th}>Workspace Name</th>
                  <th className={styles.th}>Local Path</th>
                  <th className={styles.th}>Description</th>
                  <th className={styles.thW28}>Status</th>
                  <th className={styles.thW24}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {workspaces.length === 0 ? (
                  <tr>
                    <td colSpan={6} className={styles.tdEmpty}>
                      No project workspaces found.
                    </td>
                  </tr>
                ) : (
                  workspaces.map(p => (
                      <tr key={p.id} className={styles.tr}>
                        <td className={styles.td}>
                          <span
                            className={styles.colorTag}
                            style={{ backgroundColor: p.color }}
                          />
                        </td>
                        <td className={styles.tdName}>{p.name}</td>
                        <td className={styles.tdPath}>{p.path}</td>
                        <td className={styles.tdDesc}>{p.description}</td>
                        <td className={styles.td}>
                          <span className={cx(
                            styles.statusBadge,
                            p.status === 'active' ? styles.statusActive : styles.statusInactive
                          )}>
                            {p.status}
                          </span>
                        </td>
                        <td className={styles.td}>
                          <div className={styles.actionGroup}>
                            <button
                              onClick={() => handleEditWorkspaceClick(p)}
                              className={styles.editButton}
                            >
                              <Edit2 className={styles.actionIcon} />
                            </button>
                            <button
                              onClick={() => {
                                setConfirmMessage(`Delete workspace "${p.name}"? All associated logs and references will be removed.`);
                                setConfirmAction(() => () => deleteWorkspace(p.id));
                                setConfirmOpen(true);
                              }}
                              className={styles.deleteButton}
                            >
                              <Trash2 className={styles.actionIcon} />
                            </button>
                          </div>
                        </td>
                      </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TERMINAL TAB */}
      {activeTab === 'terminal' && (
        <div className={styles.tabContentContainer}>
          <div className={styles.integrationsCard}>
            <h3 className={styles.cardTitle}>
              <Terminal className={cx(styles.cardTitleIcon, styles.terminalIcon)} />
              <span>Default Terminal Shell</span>
            </h3>
            <p className={styles.cardDescription}>
              Shell launched when opening a new terminal tab in any workspace.
              Detected from your system — changes take effect the next time you open a terminal.
            </p>

            {shellsLoading ? (
              <div className={styles.flexCenterGap3}>
                <RefreshCw className={cx(styles.refreshIcon, styles.spin)} />
                <span className={styles.cardDescription}>Detecting installed shells…</span>
              </div>
            ) : (
              <>
                {!useCustomPath ? (
                  <Select
                    label="Shell"
                    value={defaultShell}
                    onChange={setDefaultShell}
                    options={(detectedShells.length > 0 ? detectedShells : FALLBACK_SHELLS).map((s) => ({
                      value: s.path,
                      name: s.name,
                      description: s.path,
                    }))}
                    error={shellsError}
                  />
                ) : (
                  <div>
                    <label className={styles.formLabel}>Custom Shell Path</label>
                    <Input
                      type="text"
                      className={styles.integrationInput}
                      value={customShellPath}
                      onChange={e => setCustomShellPath(e.target.value)}
                      placeholder={`e.g. C:\\Program Files\\Git\\bin\\bash.exe`}
                    />
                  </div>
                )}

                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => {
                    if (!useCustomPath) setCustomShellPath(defaultShell);
                    setUseCustomPath(p => !p);
                  }}
                >
                  {useCustomPath ? '← Use detected shell' : 'Use custom path'}
                </button>

                <p className={styles.shellHelperText}>
                  {'✓ New terminals will open with: '}
                  <strong>
                    {useCustomPath
                      ? (customShellPath.trim() || '—')
                      : shellDisplayName(defaultShell, detectedShells.length > 0 ? detectedShells : FALLBACK_SHELLS)}
                  </strong>
                </p>

              </>
            )}
          </div>

          {/* ── Colors & Theme ──────────────────────────────────────────────────── */}
          <div className={styles.integrationsCard}>
            <h3 className={styles.cardTitle}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>🎨</span>
              <span>Colors & Theme</span>
            </h3>
            <p className={styles.cardDescription}>
              Pick a preset or customize all 22 terminal colors individually.
            </p>

            {/* Preset cards */}
            <div className={css`display:flex;flex-wrap:wrap;gap:8px;`}>
              {TERMINAL_THEME_PRESETS.map(preset => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => setTerminalConfig(c => ({ ...c, theme: preset.theme }))}
                  className={css`
                    padding:5px 12px;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600;
                    border:1px solid ${terminalConfig.theme.background === preset.theme.background
                      ? 'var(--color-brand)' : 'var(--border-color)'};
                    background:${preset.theme.background};
                    color:${preset.theme.foreground};
                    transition:border-color 0.15s;
                    &:hover{border-color:var(--color-brand);}
                  `}
                >
                  {preset.name}
                </button>
              ))}
            </div>

            {/* Expand/collapse custom color editor */}
            <button
              type="button"
              onClick={() => setShowCustomColors(v => !v)}
              className={css`
                background:none;border:none;padding:0;cursor:pointer;
                font-size:var(--font-size-xs);color:var(--color-brand);
                text-decoration:underline;text-underline-offset:2px;align-self:flex-start;
                &:hover{filter:brightness(1.15);}
              `}
            >
              {showCustomColors ? '▲ Hide custom colors' : '▼ Customize colors'}
            </button>

            {/* Color grid — color picker + hex/rgba text input per slot */}
            {showCustomColors && <div className={css`
              display:grid;grid-template-columns:repeat(2,1fr);gap:10px;
              @media(min-width:560px){grid-template-columns:repeat(3,1fr);}
            `}>
              {(
                [
                  ['Background',     'background'],
                  ['Foreground',     'foreground'],
                  ['Cursor',         'cursor'],
                  ['Cursor Accent',  'cursorAccent'],
                  ['Selection BG',   'selectionBackground'],
                  ['Selection FG',   'selectionForeground'],
                  ['Black',          'black'],
                  ['Bright Black',   'brightBlack'],
                  ['Red',            'red'],
                  ['Bright Red',     'brightRed'],
                  ['Green',          'green'],
                  ['Bright Green',   'brightGreen'],
                  ['Yellow',         'yellow'],
                  ['Bright Yellow',  'brightYellow'],
                  ['Blue',           'blue'],
                  ['Bright Blue',    'brightBlue'],
                  ['Magenta',        'magenta'],
                  ['Bright Magenta', 'brightMagenta'],
                  ['Cyan',           'cyan'],
                  ['Bright Cyan',    'brightCyan'],
                  ['White',          'white'],
                  ['Bright White',   'brightWhite'],
                ] as [string, keyof TerminalConfig['theme']][]
              ).map(([label, key]) => {
                const val = terminalConfig.theme[key];
                const isRgba = val.startsWith('rgba');
                return (
                  <div key={key} className={css`display:flex;flex-direction:column;gap:3px;`}>
                    <label className={styles.formLabel}>{label}</label>
                    <div className={css`display:flex;align-items:center;gap:5px;`}>
                      <input
                        type="color"
                        title={isRgba ? 'rgba — edit text field for alpha' : undefined}
                        value={isRgba ? '#000000' : val}
                        onChange={e => setTerminalConfig(c => ({
                          ...c, theme: { ...c.theme, [key]: e.target.value },
                        }))}
                        className={css`width:28px;height:26px;border:none;background:transparent;cursor:pointer;padding:0;flex-shrink:0;`}
                      />
                      <Input
                        type="text"
                        value={val}
                        spellCheck={false}
                        onChange={e => setTerminalConfig(c => ({
                          ...c, theme: { ...c.theme, [key]: e.target.value },
                        }))}
                        className={styles.integrationInput}
                      />
                    </div>
                  </div>
                );
              })}
            </div>}
          </div>

          {/* ── Font ──────────────────────────────────────────────────────── */}
          <div className={styles.integrationsCard}>
            <h3 className={styles.cardTitle}>
              <span style={{ fontSize: 16, fontFamily: 'monospace', fontWeight: 700 }}>Aa</span>
              <span>Font</span>
            </h3>

            <div>
              <label className={styles.formLabel}>Font Family</label>
              <Input
                type="text"
                spellCheck={false}
                className={styles.integrationInput}
                value={terminalConfig.fontFamily}
                onChange={e => setTerminalConfig(c => ({ ...c, fontFamily: e.target.value }))}
                placeholder="'Fira Code', 'Cascadia Code', monospace"
              />
              <p className={css`font-size:10px;color:var(--text-tertiary);margin-top:4px;`}>
                Comma-separated list. First font found on the system is used.
              </p>
            </div>

            <div className={css`display:grid;grid-template-columns:repeat(3,1fr);gap:12px;`}>
              <div>
                <label className={styles.formLabel}>Size (px)</label>
                <Input
                  type="number" min={8} max={32}
                  className={styles.integrationInput}
                  value={terminalConfig.fontSize}
                  onChange={e => setTerminalConfig(c => ({ ...c, fontSize: Number(e.target.value) }))}
                />
              </div>
              <div>
                <label className={styles.formLabel}>Line Height</label>
                <Input
                  type="number" min={0.8} max={2.0} step={0.1}
                  className={styles.integrationInput}
                  value={terminalConfig.lineHeight}
                  onChange={e => setTerminalConfig(c => ({ ...c, lineHeight: Number(e.target.value) }))}
                />
              </div>
              <div>
                <label className={styles.formLabel}>Letter Spacing (px)</label>
                <Input
                  type="number" min={-2} max={10} step={0.5}
                  className={styles.integrationInput}
                  value={terminalConfig.letterSpacing}
                  onChange={e => setTerminalConfig(c => ({ ...c, letterSpacing: Number(e.target.value) }))}
                />
              </div>
            </div>
          </div>

          {/* ── Cursor ─────────────────────────────────────────────────────── */}
          <div className={styles.integrationsCard}>
            <h3 className={styles.cardTitle}>
              <span style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700 }}>|</span>
              <span>Cursor</span>
            </h3>

            <div>
              <label className={styles.formLabel}>Style</label>
              <div className={css`display:flex;gap:8px;`}>
                {(['block', 'underline', 'bar'] as const).map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setTerminalConfig(c => ({ ...c, cursorStyle: s }))}
                    className={css`
                      padding:6px 16px;border-radius:4px;font-size:12px;cursor:pointer;
                      border:1px solid ${terminalConfig.cursorStyle === s ? 'var(--color-brand)' : 'var(--border-color)'};
                      background:${terminalConfig.cursorStyle === s ? 'rgba(123,104,238,0.15)' : 'transparent'};
                      color:${terminalConfig.cursorStyle === s ? 'var(--color-brand)' : 'var(--text-secondary)'};
                      &:hover{border-color:var(--color-brand);}
                    `}
                  >
                    {s === 'block' ? '█ Block' : s === 'underline' ? '▁ Underline' : '| Bar'}
                  </button>
                ))}
              </div>
            </div>

            <label className={css`display:flex;align-items:center;gap:8px;cursor:pointer;`}>
              <input
                type="checkbox"
                checked={terminalConfig.cursorBlink}
                onChange={e => setTerminalConfig(c => ({ ...c, cursorBlink: e.target.checked }))}
              />
              <span className={styles.formLabel} style={{ margin: 0 }}>Cursor blink</span>
            </label>
          </div>

          {/* ── Behavior ────────────────────────────────────────────────────── */}
          <div className={styles.integrationsCard}>
            <h3 className={styles.cardTitle}>
              <span style={{ fontSize: 16 }}>⚙</span>
              <span>Behavior</span>
            </h3>

            <div style={{ maxWidth: 200 }}>
              <label className={styles.formLabel}>Scrollback Lines</label>
              <Input
                type="number" min={100} max={100000}
                className={styles.integrationInput}
                value={terminalConfig.scrollback}
                onChange={e => setTerminalConfig(c => ({ ...c, scrollback: Number(e.target.value) }))}
              />
            </div>

            <label className={css`display:flex;align-items:center;gap:8px;cursor:pointer;`}>
              <input
                type="checkbox"
                checked={terminalConfig.macOptionIsMeta}
                onChange={e => setTerminalConfig(c => ({ ...c, macOptionIsMeta: e.target.checked }))}
              />
              <span className={styles.formLabel} style={{ margin: 0 }}>
                Option key acts as Meta (macOS) — enables Option+B/F word-jump shortcuts
              </span>
            </label>
          </div>

          {/* ── Keybindings ─────────────────────────────────────────────────── */}
          <div className={styles.integrationsCard}>
            <h3 className={styles.cardTitle}>
              <span style={{ fontSize: 16 }}>⌨</span>
              <span>Keybindings</span>
            </h3>
            <p className={styles.cardDescription}>
              Every key combo is sent to the shell by default. Add a binding only to reserve a combo for a terminal action — use <code style={{ fontFamily: 'monospace', color: 'var(--color-brand)' }}>passthrough</code> to force an otherwise-reserved combo back to the shell. Format: <code style={{ fontFamily: 'monospace', color: 'var(--color-brand)' }}>ctrl+k</code>, <code style={{ fontFamily: 'monospace', color: 'var(--color-brand)' }}>ctrl+shift+t</code>, <code style={{ fontFamily: 'monospace', color: 'var(--color-brand)' }}>alt+b</code>. Modifiers: ctrl, alt, shift, meta.
            </p>

            {terminalConfig.keybindings.length > 0 && (
              <table className={css`width:100%;font-size:12px;border-collapse:collapse;`}>
                <thead>
                  <tr className={css`color:var(--text-secondary);font-weight:700;text-transform:uppercase;font-size:10px;border-bottom:1px solid var(--border-color);`}>
                    <th className={css`text-align:left;padding:6px 8px;`}>Key</th>
                    <th className={css`text-align:left;padding:6px 8px;`}>Action</th>
                    <th className={css`text-align:left;padding:6px 8px;`}>Text</th>
                    <th className={css`padding:6px 8px;width:32px;`} />
                  </tr>
                </thead>
                <tbody>
                  {terminalConfig.keybindings.map((binding, idx) => (
                    <tr key={idx} className={css`border-bottom:1px solid var(--border-color);`}>
                      <td className={css`padding:6px 8px;font-family:var(--font-family-mono);color:var(--color-brand);`}>
                        {binding.key}
                      </td>
                      <td className={css`padding:6px 8px;color:var(--text-primary);`}>{binding.action}</td>
                      <td className={css`padding:6px 8px;font-family:var(--font-family-mono);color:var(--text-secondary);font-size:11px;`}>
                        {binding.text || '—'}
                      </td>
                      <td className={css`padding:6px 8px;`}>
                        <button
                          type="button"
                          onClick={() => setTerminalConfig(c => ({
                            ...c,
                            keybindings: c.keybindings.filter((_, i) => i !== idx),
                          }))}
                          className={css`background:none;border:none;cursor:pointer;color:var(--text-secondary);font-size:14px;&:hover{color:var(--color-error);}`}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Add new binding */}
            <div className={css`display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;`}>
              <div className={css`display:flex;flex-direction:column;gap:4px;min-width:110px;`}>
                <label className={styles.formLabel}>Key Combo</label>
                <Input
                  type="text"
                  className={styles.integrationInput}
                  value={newBinding.key}
                  onChange={e => setNewBinding(b => ({ ...b, key: e.target.value.toLowerCase() }))}
                  placeholder="ctrl+k"
                  spellCheck={false}
                />
              </div>

              <div className={css`display:flex;flex-direction:column;gap:4px;`}>
                <label className={styles.formLabel}>Action</label>
                <select
                  className={styles.integrationInput}
                  value={newBinding.action}
                  onChange={e => setNewBinding(b => ({
                    ...b,
                    action: e.target.value as TerminalKeybinding['action'],
                  }))}
                >
                  <option value="clear">clear</option>
                  <option value="scroll-top">scroll-top</option>
                  <option value="scroll-bottom">scroll-bottom</option>
                  <option value="send-text">send-text</option>
                  <option value="copy">copy</option>
                  <option value="paste">paste</option>
                  <option value="passthrough">passthrough</option>
                </select>
              </div>

              {newBinding.action === 'send-text' && (
                <div className={css`display:flex;flex-direction:column;gap:4px;flex:1;min-width:120px;`}>
                  <label className={styles.formLabel}>Text / Sequence</label>
                  <Input
                    type="text"
                    className={styles.integrationInput}
                    value={newBinding.text ?? ''}
                    onChange={e => setNewBinding(b => ({ ...b, text: e.target.value }))}
                    placeholder="e.g. clear\n"
                    spellCheck={false}
                  />
                </div>
              )}

              <button
                type="button"
                disabled={!newBinding.key.trim()}
                onClick={() => {
                  setTerminalConfig(c => ({
                    ...c,
                    keybindings: [...c.keybindings, { ...newBinding, key: newBinding.key.trim() }],
                  }));
                  setNewBinding({ key: '', action: 'clear', text: '' });
                }}
                className={css`
                  padding:8px 16px;border-radius:var(--border-radius-sm);font-size:12px;font-weight:700;
                  cursor:pointer;border:1px solid var(--color-brand);color:var(--color-brand);background:transparent;
                  &:hover:not(:disabled){background:rgba(123,104,238,0.1);}
                  &:disabled{opacity:0.4;cursor:not-allowed;}
                `}
              >
                + Add
              </button>
            </div>
          </div>

          {/* ── Save ─────────────────────────────────────────────────────────── */}
          <div className={css`display:flex;justify-content:flex-end;padding-bottom:8px;`}>
            <button
              type="button"
              className={styles.amberButton}
              onClick={() => {
                const path = (useCustomPath ? customShellPath : defaultShell).trim();
                // Terminal appearance + keybindings are independent of the shell
                // path — save them even when no shell is set (don't block on it).
                updateSettings(path ? { shellPath: path, terminalConfig } : { terminalConfig });
                showToast('Terminal settings saved', 'success');
              }}
            >
              Save Terminal Settings
            </button>
          </div>
        </div>
      )}

      {/* DELETE CONFIRM DIALOG */}
      <ConfirmDialog
        isOpen={confirmOpen}
        message={confirmMessage}
        onConfirm={() => {
          confirmAction?.();
          setConfirmOpen(false);
          setConfirmAction(null);
        }}
        onCancel={() => {
          setConfirmOpen(false);
          setConfirmAction(null);
        }}
      />

      {/* EDIT WORKSPACE DIALOG */}
      {editingWorkspace && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalContent}>
            <h3 className={styles.modalTitle}>Edit Workspace Configuration</h3>
            <form onSubmit={handleUpdateWorkspaceSubmit} className={styles.formContainer}>
              <div>
                <label className={styles.formLabel}>Workspace Name</label>
                <Input
                  type="text"
                  value={projName}
                  onChange={(e) => setProjName(e.target.value)}
                  className={styles.dialogInput}
                  required
                />
              </div>

              <div>
                <label className={styles.formLabel}>Local Directory Path</label>
                <Input
                  type="text"
                  value={projPath}
                  onChange={(e) => setProjPath(e.target.value)}
                  className={styles.dialogInput}
                  required
                />
              </div>

              <div>
                <label className={styles.formLabel}>Description</label>
                <textarea
                  value={projDesc}
                  onChange={(e) => setProjDesc(e.target.value)}
                  rows={2}
                  className={styles.dialogTextarea}
                />
              </div>

              <div className={styles.grid2Col}>
                <div>
                  <label className={styles.formLabel}>Color Theme</label>
                  <input
                    type="color"
                    value={projColor}
                    onChange={(e) => setProjColor(e.target.value)}
                    className={styles.colorInput}
                  />
                </div>

                <div>
                  <Select
                    label='Status'
                    value={projStatus}
                    onChange={v => setProjStatus(v as Workspace['status'])}
                    options={[
                      { value: 'active', name: 'Active' },
                      { value: 'paused', name: 'Paused' },
                      { value: 'idle',   name: 'Idle'   },
                    ]}
                  />
                </div>
              </div>

              <div className={styles.modalButtons}>
                <button
                  type="button"
                  onClick={() => setEditingWorkspace(null)}
                  className={styles.modalCancelButton}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.modalSubmitButton}
                >
                  Update Workspace
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

const styles = {
  container: css`
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow-y: auto;
    padding: var(--spacing-xl);
    gap: var(--spacing-xl);
    background-color: var(--bg-primary);
  `,
  title: css`
    font-size: var(--font-size-2xl);
    font-weight: var(--font-weight-bold);
    letter-spacing: -0.025em;
    color: var(--text-primary);
  `,
  description: css`
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    font-weight: var(--font-weight-medium);
    margin-top: 4px;
  `,
  tabsContainer: css`
    display: flex;
    border-bottom: 1px solid var(--border-color);
    gap: 24px;
  `,
  tabButton: css`
    padding-bottom: 12px;
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    letter-spacing: 0.025em;
    transition: color 0.2s ease-in-out;
    position: relative;
    cursor: pointer;
    background: none;
    border: none;
    outline: none;
  `,
  tabButtonActive: css`
    color: var(--color-brand);
  `,
  tabButtonInactive: css`
    color: var(--text-tertiary);
    &:hover {
      color: var(--text-primary);
    }
  `,
  tabActiveLine: css`
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 2px;
    background-color: var(--color-brand);
    border-radius: 9999px;
  `,
  tabContentContainer: css`
    display: flex;
    flex-direction: column;
    gap: 24px;
    max-width: 42rem; /* max-w-2xl */
  `,
  card: css`
    padding: var(--spacing-lg);
    border-radius: var(--border-radius-lg);
    border: 1px solid var(--border-color);
    background-color: var(--bg-secondary);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
  `,
  aiDisabledSection: css`
    opacity: 0.45;
    pointer-events: none;
    filter: grayscale(0.5);
    user-select: none;
    transition: opacity 0.2s, filter 0.2s;
  `,
  integrationsCard: css`
    padding: var(--spacing-lg);
    border-radius: var(--border-radius-lg);
    border: 1px solid var(--border-color);
    background-color: var(--bg-secondary);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
  `,
  cardTitle: css`
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  `,
  cardTitleIcon: css`
    width: 20px;
    height: 20px;
  `,
  sunIcon: css`
    color: var(--color-warning);
  `,
  sunIconYellow: css`
    color: var(--color-warning);
  `,
  moonIconBlue: css`
    color: var(--color-brand);
  `,
  downloadIcon: css`
    color: var(--color-brand);
  `,
  settingsIcon: css`
    color: var(--color-brand);
  `,
  cardDescription: css`
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    line-height: 1.625;
  `,
  flexCenterGap3: css`
    display: flex;
    align-items: center;
    gap: 12px;
  `,
  themeToggleButton: css`
    display: flex;
    align-items: center;
    gap: 8px;
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: 8px 16px;
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
    transition: all 0.2s ease-in-out;
    cursor: pointer;
    
    &:hover {
      background-color: var(--bg-hover);
    }
  `,
  themeToggleIcon: css`
    width: 16px;
    height: 16px;
  `,
  currentThemeBadge: css`
    font-size: 10px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 800;
  `,
  flexWrapGap3: css`
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  `,
  primaryButton: css`
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--gradient-brand);
    color: #ffffff;
    padding: 8px 16px;
    border: none;
    border-radius: var(--border-radius-sm);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    transition: all 0.2s ease-in-out;
    box-shadow: var(--shadow-brand);
    cursor: pointer;
    
    &:hover {
      filter: brightness(1.06);
    }
  `,
  secondaryButton: css`
    display: flex;
    align-items: center;
    gap: 8px;
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
    padding: 8px 16px;
    border-radius: var(--border-radius-sm);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    transition: all 0.2s ease-in-out;
    cursor: pointer;
    
    &:hover {
      background-color: var(--bg-hover);
    }
  `,
  btnIcon: css`
    width: 16px;
    height: 16px;
  `,
  hidden: css`
    display: none;
  `,
  integrationForm: css`
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
    padding-top: var(--spacing-xs);
  `,
  grid2Col: css`
    display: grid;
    grid-template-columns: 1fr;
    gap: 16px;
    
    @media (min-width: 768px) {
      grid-template-columns: repeat(2, 1fr);
    }
  `,
  formLabel: css`
    display: block;
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--text-secondary);
    margin-bottom: var(--spacing-xs);
  `,
  integrationInput: css`
    width: 100%;
    background-color: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: 8px;
    font-size: var(--font-size-xs);
    color: var(--text-primary);
    outline: none;
    transition: all 0.15s ease-in-out;
    
    &:focus {
      border-color: var(--color-brand);
      box-shadow: 0 0 0 1px var(--color-brand);
    }
  `,
  flexEndPt2: css`
    display: flex;
    justify-content: flex-end;
    padding-top: 8px;
  `,
  amberButton: css`
    background: var(--gradient-brand);
    color: #fff;
    padding: 8px 16px;
    border: none;
    border-radius: var(--border-radius-sm);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    transition: all 0.2s ease-in-out;
    box-shadow: var(--shadow-brand);
    cursor: pointer;
    
    &:hover {
      filter: brightness(1.06);
    }
  `,
  tableWrapper: css`
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-lg);
    background-color: var(--bg-secondary);
    overflow: hidden;
  `,
  table: css`
    width: 100%;
    text-align: left;
    font-size: var(--font-size-xs);
    border-collapse: collapse;
  `,
  thRow: css`
    background-color: var(--bg-tertiary);
    color: var(--text-secondary);
    border-bottom: 1px solid var(--border-color);
    font-weight: var(--font-weight-bold);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  `,
  th: css`
    padding: 16px;
    font-weight: inherit;
  `,
  thW12: css`
    padding: 16px;
    width: 48px;
    font-weight: inherit;
  `,
  thW28: css`
    padding: 16px;
    width: 112px;
    font-weight: inherit;
  `,
  thW36: css`
    padding: 16px;
    width: 144px;
    font-weight: inherit;
  `,
  thW24: css`
    padding: 16px;
    width: 96px;
    font-weight: inherit;
  `,
  tr: css`
    border-bottom: 1px solid var(--border-color);
    transition: background-color 0.2s ease;
    
    &:hover {
      background-color: var(--bg-hover);
    }
  `,
  tdEmpty: css`
    padding: 32px;
    text-align: center;
    color: var(--text-tertiary);
  `,
  colorTag: css`
    display: block;
    width: 16px;
    height: 16px;
    border-radius: 4px;
  `,
  colorTagFull: css`
    display: block;
    width: 16px;
    height: 16px;
    border-radius: 50%;
  `,
  td: css`
    padding: 16px;
    vertical-align: middle;
  `,
  tdName: css`
    padding: 16px;
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    vertical-align: middle;
  `,
  tdPath: css`
    padding: 16px;
    font-family: var(--font-family-mono);
    font-size: 11px;
    color: var(--color-brand);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 20rem; /* max-w-xs */
    vertical-align: middle;
  `,
  tdDesc: css`
    padding: 16px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 20rem; /* max-w-xs */
    vertical-align: middle;
  `,
  tdAgent: css`
    padding: 16px;
    color: var(--text-secondary);
    font-weight: var(--font-weight-medium);
    vertical-align: middle;
  `,
  tdAgentType: css`
    padding: 16px;
    text-transform: uppercase;
    color: var(--text-secondary);
    font-weight: var(--font-weight-semibold);
    vertical-align: middle;
  `,
  tdAgentCmd: css`
    padding: 16px;
    font-family: var(--font-family-mono);
    font-size: 10px;
    color: var(--color-warning);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 20rem; /* max-w-xs */
    vertical-align: middle;
  `,
  italicMuted: css`
    font-style: italic;
    color: var(--text-tertiary);
  `,
  actionGroup: css`
    display: flex;
    align-items: center;
    gap: 8px;
  `,
  editButton: css`
    padding: 6px;
    border: none;
    border-radius: var(--border-radius-sm);
    background-color: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease-in-out;
    
    &:hover {
      background-color: var(--bg-hover);
      color: var(--text-primary);
    }
  `,
  deleteButton: css`
    padding: 6px;
    border: none;
    border-radius: var(--border-radius-sm);
    background-color: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease-in-out;
    
    &:hover {
      background-color: rgba(239, 68, 68, 0.1);
      color: var(--color-error);
    }
  `,
  actionIcon: css`
    width: 14px;
    height: 14px;
  `,
  statusBadge: css`
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 800;
    text-transform: uppercase;
  `,
  statusActive: css`
    background-color: rgba(52, 211, 153, 0.1);
    color: var(--color-success);
  `,
  statusInactive: css`
    background-color: var(--bg-tertiary);
    color: var(--text-secondary);
  `,
  modalBackdrop: css`
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background-color: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    animation: fadeIn 0.2s ease-out;
    
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  `,
  modalContent: css`
    width: 100%;
    max-width: 28rem; /* max-w-md */
    border-radius: var(--border-radius-lg);
    background-color: var(--bg-secondary);
    border: 1px solid var(--border-color);
    box-shadow: var(--shadow-lg), 0 0 20px rgba(123, 104, 238, 0.15);
    padding: var(--spacing-lg);
    animation: slideUp 0.25s ease-out;
    
    @keyframes slideUp {
      from { transform: translateY(16px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  `,
  modalTitle: css`
    font-size: var(--font-size-xl);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    margin-bottom: var(--spacing-md);
  `,
  formContainer: css`
    display: flex;
    flex-direction: column;
    gap: 16px;
  `,
  dialogInput: css`
    width: 100%;
    background-color: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: 8px;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    outline: none;
    transition: all 0.15s ease-in-out;
    
    &:focus {
      border-color: var(--color-brand);
      box-shadow: 0 0 0 1px var(--color-brand);
    }
  `,
  dialogTextarea: css`
    width: 100%;
    background-color: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: 8px;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    outline: none;
    font-family: inherit;
    resize: vertical;
    transition: all 0.15s ease-in-out;
    
    &:focus {
      border-color: var(--color-brand);
      box-shadow: 0 0 0 1px var(--color-brand);
    }
  `,
  colorInput: css`
    width: 100%;
    height: 36px;
    background-color: transparent;
    border: none;
    border-radius: var(--border-radius-sm);
    cursor: pointer;
  `,
  modalButtons: css`
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding-top: 8px;
  `,
  modalCancelButton: css`
    background-color: transparent;
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
    padding: 8px 16px;
    border-radius: var(--border-radius-sm);
    cursor: pointer;
    transition: all 0.2s ease-in-out;
    
    &:hover {
      color: var(--text-primary);
      border-color: var(--border-color-hover);
    }
  `,
  modalSubmitButton: css`
    background: var(--gradient-brand);
    color: #ffffff;
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    padding: 8px 16px;
    border: none;
    border-radius: var(--border-radius-sm);
    transition: filter 0.2s ease-in-out;
    cursor: pointer;

    &:hover {
      filter: brightness(1.06);
    }
  `,

  // ── Conductor section ─────────────────────────────────────────────────────
  conductorRow: css`
    display: flex;
    gap: 16px;
    align-items: flex-end;
    flex-wrap: wrap;
  `,
  modelPickerRow: css`
    display: flex;
    gap: 6px;
    align-items: center;
  `,
  refreshBtn: css`
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: 7px 8px;
    cursor: pointer;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s, background-color 0.15s;

    &:hover:not(:disabled) { color: var(--text-primary); background-color: var(--bg-hover); }
    &:disabled { opacity: 0.4; cursor: not-allowed; }
  `,
  refreshIcon: css`
    width: 14px;
    height: 14px;
  `,
  spin: css`
    animation: settingsSpin 1s linear infinite;
    @keyframes settingsSpin {
      from { transform: rotate(0deg); }
      to   { transform: rotate(360deg); }
    }
  `,
  modelsError: css`
    font-size: 10px;
    color: var(--color-error);
    margin-top: 4px;
  `,

  // ── Terminal tab ───────────────────────────────────────────────────────────
  terminalIcon: css`
    color: var(--color-brand);
  `,
  linkBtn: css`
    background: none;
    border: none;
    padding: 0;
    font-size: var(--font-size-xs);
    color: var(--color-brand);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
    align-self: flex-start;

    &:hover { filter: brightness(1.15); }
  `,
  shellHelperText: css`
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    margin-top: 2px;

    strong { color: var(--text-primary); }
  `,
};
