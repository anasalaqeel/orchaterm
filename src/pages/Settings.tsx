import React, { useState, useRef, useEffect } from 'react';
import { css, cx } from '@emotion/css';
import { useDashboard } from '../context/DashboardContext';
import { Workspace, Agent } from '../types';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { fetchOllamaModels } from '../services/ollamaRelay';
import {
  Sun,
  Moon,
  Download,
  Upload,
  Trash2,
  Edit2,
  Settings,
  RefreshCw,
  Network,
} from 'lucide-react';

export const SettingsView: React.FC = () => {
  const {
    workspaces,
    agents,
    theme,
    toggleTheme,
    exportSettings,
    importSettings,
    updateWorkspace,
    deleteWorkspace,
    updateAgent,
    deleteAgent,
    showToast,
    settings,
    updateSettings
  } = useDashboard();

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Integration Settings form states
  const [shellPath, setShellPath] = useState(settings.shellPath);
  const [ollamaHost, setOllamaHost] = useState(settings.ollamaHost);
  const [openaiApiKey, setOpenaiApiKey] = useState(settings.openaiApiKey);
  const [anthropicApiKey, setAnthropicApiKey] = useState(settings.anthropicApiKey);

  // Conductor settings
  const [conductorOllamaModel, setConductorOllamaModel] = useState(settings.conductorOllamaModel);
  const [conductorTaskTimeoutMinutes, setConductorTaskTimeoutMinutes] = useState(
    settings.conductorTaskTimeoutMinutes
  );
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');

  const loadOllamaModels = async () => {
    setModelsLoading(true);
    setModelsError('');
    try {
      const models = await fetchOllamaModels(ollamaHost || settings.ollamaHost);
      setOllamaModels(models);
      if (models.length > 0 && !conductorOllamaModel) {
        setConductorOllamaModel(models[0]);
      }
    } catch (err: any) {
      setModelsError(err?.message ?? 'Could not reach Ollama');
    } finally {
      setModelsLoading(false);
    }
  };

  useEffect(() => {
    setShellPath(settings.shellPath);
    setOllamaHost(settings.ollamaHost);
    setOpenaiApiKey(settings.openaiApiKey);
    setAnthropicApiKey(settings.anthropicApiKey);
    setConductorOllamaModel(settings.conductorOllamaModel);
    setConductorTaskTimeoutMinutes(settings.conductorTaskTimeoutMinutes);
  }, [settings]);

  // Pre-load models when component mounts so the dropdown is ready
  useEffect(() => {
    if (settings.ollamaHost) {
      loadOllamaModels();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveIntegrations = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings({
      shellPath,
      ollamaHost,
      openaiApiKey,
      anthropicApiKey,
      conductorOllamaModel,
      conductorTaskTimeoutMinutes,
    });
    showToast('Settings saved', 'success');
  };

  // Confirm delete dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState('');
  const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);

  // Tabs for settings sections
  const [activeTab, setActiveTab] = useState<'general' | 'projects' | 'agents'>('general');

  // Modals / forms state
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);

  // New/Edit Workspace Form State
  const [projName, setProjName] = useState('');
  const [projPath, setProjPath] = useState('');
  const [projDesc, setProjDesc] = useState('');
  const [projColor, setProjColor] = useState('#3b82f6');
  const [projStatus, setProjStatus] = useState<'active' | 'paused' | 'idle'>('active');
  const [projAgent, setProjAgent] = useState('');

  // New/Edit Agent Form State
  const [agentName, setAgentName] = useState('');
  const [agentType, setAgentType] = useState<'terminal' | 'web' | 'ide-plugin' | 'other'>('terminal');
  const [agentLaunchUrl, setAgentLaunchUrl] = useState('');
  const [agentLaunchCommand, setAgentLaunchCommand] = useState('');
  const [agentBestUsedFor, setAgentBestUsedFor] = useState('');
  const [agentColor, setAgentColor] = useState('#3b82f6');

  // Export Settings Handler
  const handleExport = () => {
    try {
      const dataStr = exportSettings();
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `agentdeck_backup_${new Date().toISOString().split('T')[0]}.json`;
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
    setProjAgent(w.agentId || '');
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
      agentId: projAgent || null
    });

    setEditingWorkspace(null);
    setProjName('');
    setProjPath('');
    setProjDesc('');
    showToast('Workspace updated successfully', 'success');
  };

  // AGENT CRUD
  const handleEditAgentClick = (a: Agent) => {
    setEditingAgent(a);
    setAgentName(a.name);
    setAgentType(a.type);
    setAgentLaunchUrl(a.launchUrl || '');
    setAgentLaunchCommand(a.launchCommand || '');
    setAgentBestUsedFor(a.bestUsedFor || '');
    setAgentColor(a.color || '#3b82f6');
  };

  const handleUpdateAgentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAgent) return;
    if (!agentName.trim()) {
      showToast('Agent name is required', 'error');
      return;
    }

    updateAgent(editingAgent.id, {
      name: agentName,
      type: agentType,
      launchUrl: agentType === 'web' ? agentLaunchUrl.trim() : null,
      launchCommand: agentType === 'terminal' ? agentLaunchCommand.trim() : null,
      bestUsedFor: agentBestUsedFor,
      color: agentColor
    });

    setEditingAgent(null);
    setAgentName('');
    setAgentBestUsedFor('');
    showToast('Agent updated successfully', 'success');
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
          onClick={() => setActiveTab('agents')}
          className={cx(
            styles.tabButton,
            activeTab === 'agents' ? styles.tabButtonActive : styles.tabButtonInactive
          )}
        >
          Agent Registry ({agents.length})
          {activeTab === 'agents' && <span className={styles.tabActiveLine} />}
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

          {/* Integration & API keys card */}
          <div className={styles.integrationsCard}>
            <h3 className={styles.cardTitle}>
              <Settings className={cx(styles.cardTitleIcon, styles.settingsIcon)} />
              <span>Developer Integrations & APIs</span>
            </h3>
            <p className={styles.cardDescription}>
              Configure your default interactive terminal shell path, local Ollama API host, and backup cloud keys for OpenAI/Anthropic model execution.
            </p>
            <form onSubmit={handleSaveIntegrations} className={styles.integrationForm}>
              <div className={styles.grid2Col}>
                <div>
                  <label className={styles.formLabel}>Terminal Shell Executable</label>
                  <select
                    value={shellPath}
                    onChange={(e) => setShellPath(e.target.value)}
                    className={styles.integrationSelect}
                  >
                    <option value="">— Select a shell —</option>
                    <option value="powershell.exe">PowerShell (powershell.exe)</option>
                    <option value="cmd.exe">Command Prompt (cmd.exe)</option>
                    <option value="wsl.exe">WSL (wsl.exe)</option>
                    <option value="bash">Git Bash (bash)</option>
                    <option value="C:\Program Files\Git\bin\bash.exe">Git Bash — full path</option>
                  </select>
                </div>
                <div>
                  <label className={styles.formLabel}>Ollama API Host</label>
                  <input
                    type="text"
                    value={ollamaHost}
                    onChange={(e) => setOllamaHost(e.target.value)}
                    placeholder="e.g. http://localhost:11434"
                    className={styles.integrationInput}
                  />
                </div>
              </div>

              <div className={styles.grid2Col}>
                <div>
                  <label className={styles.formLabel}>OpenAI API Key (Cloud Fallback)</label>
                  <input
                    type="password"
                    value={openaiApiKey || ''}
                    onChange={(e) => setOpenaiApiKey(e.target.value)}
                    placeholder="sk-..."
                    className={styles.integrationInput}
                  />
                </div>
                <div>
                  <label className={styles.formLabel}>Anthropic API Key (Cloud Fallback)</label>
                  <input
                    type="password"
                    value={anthropicApiKey || ''}
                    onChange={(e) => setAnthropicApiKey(e.target.value)}
                    placeholder="sk-ant-..."
                    className={styles.integrationInput}
                  />
                </div>
              </div>

              <div className={styles.flexEndPt2}>
                <button
                  type="submit"
                  className={styles.amberButton}
                >
                  Save Integration Settings
                </button>
              </div>
            </form>
          </div>

          {/* Conductor / Ollama card */}
          <div className={styles.integrationsCard}>
            <h3 className={styles.cardTitle}>
              <Network className={cx(styles.cardTitleIcon, styles.settingsIcon)} />
              <span>Conductor Settings</span>
            </h3>
            <p className={styles.cardDescription}>
              Configure the Ollama model used as the orchestration relay and the per-task timeout.
              The relay model must be running locally via Ollama — a small/fast model like
              <code> llama3.2</code> or <code>mistral</code> is recommended.
            </p>

            <div className={styles.conductorRow}>
              <div style={{ flex: 1 }}>
                <label className={styles.formLabel}>Ollama Relay Model</label>
                <div className={styles.modelPickerRow}>
                  <select
                    className={styles.integrationSelect}
                    value={conductorOllamaModel}
                    onChange={e => setConductorOllamaModel(e.target.value)}
                    disabled={modelsLoading}
                  >
                    {ollamaModels.length === 0 ? (
                      <option value=''>— click Refresh to load models —</option>
                    ) : (
                      <>
                        <option value=''>— Select a model —</option>
                        {ollamaModels.map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </>
                    )}
                  </select>
                  <button
                    type='button'
                    className={styles.refreshBtn}
                    onClick={loadOllamaModels}
                    disabled={modelsLoading}
                    title='Refresh model list from Ollama'
                  >
                    <RefreshCw className={cx(styles.refreshIcon, modelsLoading && styles.spin)} />
                  </button>
                </div>
                {modelsError && (
                  <p className={styles.modelsError}>{modelsError}</p>
                )}
              </div>

              <div style={{ width: 160 }}>
                <label className={styles.formLabel}>Task Timeout (minutes)</label>
                <input
                  type='number'
                  min={1}
                  max={480}
                  className={styles.integrationInput}
                  value={conductorTaskTimeoutMinutes}
                  onChange={e => setConductorTaskTimeoutMinutes(Number(e.target.value))}
                />
              </div>
            </div>

            <div className={styles.flexEndPt2}>
              <button
                type='button'
                className={styles.amberButton}
                onClick={() => {
                  updateSettings({ conductorOllamaModel, conductorTaskTimeoutMinutes });
                  showToast('Conductor settings saved', 'success');
                }}
              >
                Save Conductor Settings
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
                  <th className={styles.thW36}>Assigned Agent</th>
                  <th className={styles.thW24}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {workspaces.length === 0 ? (
                  <tr>
                    <td colSpan={7} className={styles.tdEmpty}>
                      No project workspaces found.
                    </td>
                  </tr>
                ) : (
                  workspaces.map(p => {
                    const agent = agents.find(a => a.id === p.agentId);
                    return (
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
                        <td className={styles.tdAgent}>
                          {agent ? agent.name : <span className={styles.italicMuted}>None</span>}
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
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* AGENTS MANAGEMENT TAB */}
      {activeTab === 'agents' && (
        <div>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr className={styles.thRow}>
                  <th className={styles.thW12}>Tag</th>
                  <th className={styles.th}>Agent Name</th>
                  <th className={styles.th}>Type</th>
                  <th className={styles.th}>Best Used For</th>
                  <th className={styles.th}>Endpoint / Command</th>
                  <th className={styles.thW24}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {agents.length === 0 ? (
                  <tr>
                    <td colSpan={6} className={styles.tdEmpty}>
                      No registered agents found.
                    </td>
                  </tr>
                ) : (
                  agents.map(a => (
                    <tr key={a.id} className={styles.tr}>
                      <td className={styles.td}>
                        <span 
                          className={styles.colorTagFull} 
                          style={{ backgroundColor: a.color }}
                        />
                      </td>
                      <td className={styles.tdName}>{a.name}</td>
                      <td className={styles.tdAgentType}>{a.type}</td>
                      <td className={styles.tdDesc}>{a.bestUsedFor}</td>
                      <td className={styles.tdAgentCmd}>
                        {a.type === 'terminal' ? a.launchCommand : a.launchUrl || 'N/A'}
                      </td>
                      <td className={styles.td}>
                        <div className={styles.actionGroup}>
                          <button
                            onClick={() => handleEditAgentClick(a)}
                            className={styles.editButton}
                          >
                            <Edit2 className={styles.actionIcon} />
                          </button>
                          <button
                            onClick={() => {
                              setConfirmMessage(`Delete agent "${a.name}"? This cannot be undone.`);
                              setConfirmAction(() => () => deleteAgent(a.id));
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
                <input
                  type="text"
                  value={projName}
                  onChange={(e) => setProjName(e.target.value)}
                  className={styles.dialogInput}
                  required
                />
              </div>

              <div>
                <label className={styles.formLabel}>Local Directory Path</label>
                <input
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
                  <label className={styles.formLabel}>Status</label>
                  <select
                    value={projStatus}
                    onChange={(e) => setProjStatus(e.target.value as Workspace['status'])}
                    className={styles.dialogSelect}
                  >
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="idle">Idle</option>
                  </select>
                </div>
              </div>

              <div>
                <label className={styles.formLabel}>Assign Agent</label>
                <select
                  value={projAgent}
                  onChange={(e) => setProjAgent(e.target.value)}
                  className={styles.dialogSelect}
                >
                  <option value="">Unassigned</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
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

      {/* EDIT AGENT DIALOG */}
      {editingAgent && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalContent}>
            <h3 className={styles.modalTitle}>Modify Agent Settings</h3>
            <form onSubmit={handleUpdateAgentSubmit} className={styles.formContainer}>
              <div>
                <label className={styles.formLabel}>Agent Name</label>
                <input
                  type="text"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  className={styles.dialogInput}
                  required
                />
              </div>

              <div className={styles.grid2Col}>
                <div>
                  <label className={styles.formLabel}>Agent Type</label>
                  <select
                    value={agentType}
                    onChange={(e) => setAgentType(e.target.value as Agent['type'])}
                    className={styles.dialogSelect}
                  >
                    <option value="terminal">Terminal Binary</option>
                    <option value="web">Web Browser Page</option>
                    <option value="ide-plugin">IDE Plugin</option>
                    <option value="other">Other Service</option>
                  </select>
                </div>

                <div>
                  <label className={styles.formLabel}>Accent Theme</label>
                  <input
                    type="color"
                    value={agentColor}
                    onChange={(e) => setAgentColor(e.target.value)}
                    className={styles.colorInput}
                  />
                </div>
              </div>

              {agentType === 'terminal' && (
                <div>
                  <label className={styles.formLabel}>Terminal Launch Command</label>
                  <input
                    type="text"
                    value={agentLaunchCommand}
                    onChange={(e) => setAgentLaunchCommand(e.target.value)}
                    className={styles.dialogInput}
                    required
                  />
                </div>
              )}

              {agentType === 'web' && (
                <div>
                  <label className={styles.formLabel}>Browser Launch URL</label>
                  <input
                    type="url"
                    value={agentLaunchUrl}
                    onChange={(e) => setAgentLaunchUrl(e.target.value)}
                    className={styles.dialogInput}
                    required
                  />
                </div>
              )}

              <div>
                <label className={styles.formLabel}>Best Used For</label>
                <textarea
                  value={agentBestUsedFor}
                  onChange={(e) => setAgentBestUsedFor(e.target.value)}
                  rows={2}
                  className={styles.dialogTextarea}
                />
              </div>

              <div className={styles.modalButtons}>
                <button
                  type="button"
                  onClick={() => setEditingAgent(null)}
                  className={styles.modalCancelButton}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.modalSubmitButton}
                >
                  Update Settings
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
    background-color: rgba(2, 6, 23, 0.2);
    
    body.light & {
      background-color: rgba(248, 250, 252, 0.5);
    }
  `,
  title: css`
    font-size: var(--font-size-2xl);
    font-weight: var(--font-weight-bold);
    letter-spacing: -0.025em;
    color: var(--text-primary);
  `,
  description: css`
    font-size: var(--font-size-sm);
    color: #94a3b8;
    font-weight: var(--font-weight-medium);
    margin-top: 4px;
    
    body.light & {
      color: #64748b;
    }
  `,
  tabsContainer: css`
    display: flex;
    border-bottom: 1px solid rgba(30, 41, 59, 0.8);
    gap: 24px;
    
    body.light & {
      border-color: #cbd5e1;
    }
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
    color: #60a5fa; /* text-blue-400 */
  `,
  tabButtonInactive: css`
    color: #64748b; /* text-slate-500 */
    &:hover {
      color: #cbd5e1; /* hover:text-slate-350 */
    }
    
    body.light & {
      color: #64748b;
      &:hover {
        color: #1e293b; /* light:hover:text-slate-850 */
      }
    }
  `,
  tabActiveLine: css`
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 2px;
    background-color: #3b82f6; /* bg-blue-500 */
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
    border: 1px solid rgba(30, 41, 59, 0.5); /* border-slate-800/50 */
    background-color: rgba(15, 23, 42, 0.4); /* bg-slate-900/40 */
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
    
    body.light & {
      background-color: #ffffff;
      border-color: #cbd5e1;
    }
  `,
  integrationsCard: css`
    padding: var(--spacing-lg);
    border-radius: var(--border-radius-lg);
    border: 1px solid rgba(30, 41, 59, 0.5);
    background-color: rgba(13, 33, 49, 0.6); /* bg-[#0d2131]/60 */
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
    
    body.light & {
      background-color: #ffffff;
      border-color: #cbd5e1;
    }
  `,
  cardTitle: css`
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-bold);
    color: #f1f5f9;
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    
    body.light & {
      color: #0f172a;
    }
  `,
  cardTitleIcon: css`
    width: 20px;
    height: 20px;
  `,
  sunIcon: css`
    color: #f59e0b; /* text-amber-500 */
  `,
  sunIconYellow: css`
    color: #fbbf24; /* text-amber-400 */
  `,
  moonIconBlue: css`
    color: #60a5fa; /* text-blue-400 */
  `,
  downloadIcon: css`
    color: #3b82f6; /* text-blue-500 */
  `,
  settingsIcon: css`
    color: #ff9d00; /* text-[#FF9D00] */
  `,
  cardDescription: css`
    font-size: var(--font-size-xs);
    color: #94a3b8;
    line-height: 1.625;
    
    body.light & {
      color: #64748b;
    }
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
    background-color: #1e293b; /* bg-slate-850 / hover:bg-slate-800 */
    border: 1px solid #1e293b;
    border-radius: var(--border-radius-sm);
    padding: 8px 16px;
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    color: #e2e8f0;
    transition: all 0.2s ease-in-out;
    cursor: pointer;
    
    &:hover {
      background-color: #334155;
    }
    
    body.light & {
      background-color: #f8fafc;
      border-color: #cbd5e1;
      color: #334155;
      
      &:hover {
        background-color: #f1f5f9;
      }
    }
  `,
  themeToggleIcon: css`
    width: 16px;
    height: 16px;
  `,
  currentThemeBadge: css`
    font-size: 10px;
    color: #64748b;
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
    background-color: #2563eb;
    color: #ffffff;
    padding: 8px 16px;
    border: none;
    border-radius: var(--border-radius-sm);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    transition: all 0.2s ease-in-out;
    box-shadow: 0 10px 15px -3px rgba(59, 130, 246, 0.2);
    cursor: pointer;
    
    &:hover {
      background-color: #3b82f6;
    }
  `,
  secondaryButton: css`
    display: flex;
    align-items: center;
    gap: 8px;
    background-color: #1e293b;
    border: 1px solid #1e293b;
    color: #e2e8f0;
    padding: 8px 16px;
    border-radius: var(--border-radius-sm);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    transition: all 0.2s ease-in-out;
    cursor: pointer;
    
    &:hover {
      background-color: #334155;
    }
    
    body.light & {
      background-color: #f8fafc;
      border-color: #cbd5e1;
      color: #334155;
      
      &:hover {
        background-color: #f1f5f9;
      }
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
    color: #94a3b8;
    margin-bottom: var(--spacing-xs);
  `,
  integrationInput: css`
    width: 100%;
    background-color: #193549;
    border: 1px solid #1e3a5f;
    border-radius: var(--border-radius-sm);
    padding: 8px;
    font-size: var(--font-size-xs);
    color: #e2e8f0;
    outline: none;
    transition: all 0.15s ease-in-out;
    
    &:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 1px #3b82f6;
    }
    
    body.light & {
      background-color: #f8fafc;
      border-color: #cbd5e1;
      color: #0f172a;
      
      &:focus {
        border-color: #3b82f6;
        box-shadow: 0 0 0 1px #3b82f6;
      }
    }
  `,
  flexEndPt2: css`
    display: flex;
    justify-content: flex-end;
    padding-top: 8px;
  `,
  amberButton: css`
    background-color: #FF9D00;
    color: #0d2131;
    padding: 8px 16px;
    border: none;
    border-radius: var(--border-radius-sm);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    transition: all 0.2s ease-in-out;
    box-shadow: 0 10px 15px -3px rgba(245, 158, 11, 0.15);
    cursor: pointer;
    
    &:hover {
      background-color: #ffaa22;
    }
  `,
  tableWrapper: css`
    border: 1px solid rgba(30, 41, 59, 0.5);
    border-radius: var(--border-radius-lg);
    background-color: rgba(15, 23, 42, 0.2);
    overflow: hidden;
    
    body.light & {
      border-color: #cbd5e1;
      background-color: #ffffff;
    }
  `,
  table: css`
    width: 100%;
    text-align: left;
    font-size: var(--font-size-xs);
    border-collapse: collapse;
  `,
  thRow: css`
    background-color: rgba(2, 6, 23, 0.5);
    color: #94a3b8;
    border-bottom: 1px solid rgba(30, 41, 59, 0.8);
    font-weight: var(--font-weight-bold);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    
    body.light & {
      background-color: #f8fafc;
      border-bottom: 1px solid #cbd5e1;
      color: #475569;
    }
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
    border-bottom: 1px solid rgba(30, 41, 59, 0.4);
    transition: background-color 0.2s ease;
    
    &:hover {
      background-color: rgba(15, 23, 42, 0.1);
    }
    
    body.light & {
      border-bottom: 1px solid #f1f5f9;
      
      &:hover {
        background-color: rgba(248, 250, 252, 0.5);
      }
    }
  `,
  tdEmpty: css`
    padding: 32px;
    text-align: center;
    color: #64748b;
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
    color: #e2e8f0;
    vertical-align: middle;
    
    body.light & {
      color: #1e293b;
    }
  `,
  tdPath: css`
    padding: 16px;
    font-family: var(--font-family-mono);
    font-size: 11px;
    color: #60a5fa;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 20rem; /* max-w-xs */
    vertical-align: middle;
    
    body.light & {
      color: #2563eb;
    }
  `,
  tdDesc: css`
    padding: 16px;
    color: #94a3b8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 20rem; /* max-w-xs */
    vertical-align: middle;
    
    body.light & {
      color: #475569;
    }
  `,
  tdAgent: css`
    padding: 16px;
    color: #94a3b8;
    font-weight: var(--font-weight-medium);
    vertical-align: middle;
    
    body.light & {
      color: #334155;
    }
  `,
  tdAgentType: css`
    padding: 16px;
    text-transform: uppercase;
    color: #94a3b8;
    font-weight: var(--font-weight-semibold);
    vertical-align: middle;
    
    body.light & {
      color: #475569;
    }
  `,
  tdAgentCmd: css`
    padding: 16px;
    font-family: var(--font-family-mono);
    font-size: 10px;
    color: rgba(245, 158, 11, 0.9);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 20rem; /* max-w-xs */
    vertical-align: middle;
  `,
  italicMuted: css`
    font-style: italic;
    color: #64748b;
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
    color: #94a3b8;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease-in-out;
    
    &:hover {
      background-color: #1e293b;
      color: #f1f5f9;
    }
    
    body.light & {
      &:hover {
        background-color: #f1f5f9;
        color: #1e293b;
      }
    }
  `,
  deleteButton: css`
    padding: 6px;
    border: none;
    border-radius: var(--border-radius-sm);
    background-color: transparent;
    color: #94a3b8;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease-in-out;
    
    &:hover {
      background-color: rgba(225, 29, 72, 0.2);
      color: #fb7185;
    }
    
    body.light & {
      &:hover {
        background-color: #fff1f2;
        color: #e11d48;
      }
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
    background-color: rgba(16, 185, 129, 0.1);
    color: #34d399;
  `,
  statusInactive: css`
    background-color: #1e293b;
    color: #94a3b8;
    
    body.light & {
      background-color: #f1f5f9;
      color: #64748b;
    }
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
    background-color: rgba(2, 6, 23, 0.8);
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
    background-color: #0f172a;
    border: 1px solid #1e293b;
    box-shadow: var(--shadow-lg), 0 0 20px rgba(59, 130, 246, 0.15);
    padding: var(--spacing-lg);
    animation: slideUp 0.25s ease-out;
    
    body.light & {
      background-color: #ffffff;
      border-color: #cbd5e1;
    }
    
    @keyframes slideUp {
      from { transform: translateY(16px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  `,
  modalTitle: css`
    font-size: var(--font-size-xl);
    font-weight: var(--font-weight-bold);
    color: #f1f5f9;
    margin-bottom: var(--spacing-md);
    
    body.light & {
      color: #0f172a;
    }
  `,
  formContainer: css`
    display: flex;
    flex-direction: column;
    gap: 16px;
  `,
  dialogInput: css`
    width: 100%;
    background-color: #020617;
    border: 1px solid #1e293b;
    border-radius: var(--border-radius-sm);
    padding: 8px;
    font-size: var(--font-size-sm);
    color: #e2e8f0;
    outline: none;
    transition: all 0.15s ease-in-out;
    
    &:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 1px #3b82f6;
    }
    
    body.light & {
      background-color: #f8fafc;
      border-color: #cbd5e1;
      color: #0f172a;
      
      &:focus {
        border-color: #3b82f6;
        box-shadow: 0 0 0 1px #3b82f6;
      }
    }
  `,
  dialogTextarea: css`
    width: 100%;
    background-color: #020617;
    border: 1px solid #1e293b;
    border-radius: var(--border-radius-sm);
    padding: 8px;
    font-size: var(--font-size-sm);
    color: #e2e8f0;
    outline: none;
    font-family: inherit;
    resize: vertical;
    transition: all 0.15s ease-in-out;
    
    &:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 1px #3b82f6;
    }
    
    body.light & {
      background-color: #f8fafc;
      border-color: #cbd5e1;
      color: #0f172a;
      
      &:focus {
        border-color: #3b82f6;
        box-shadow: 0 0 0 1px #3b82f6;
      }
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
  dialogSelect: css`
    width: 100%;
    background-color: #020617;
    border: 1px solid #1e293b;
    border-radius: var(--border-radius-sm);
    padding: 8px;
    font-size: var(--font-size-sm);
    color: #cbd5e1;
    outline: none;
    transition: all 0.15s ease-in-out;
    
    &:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 1px #3b82f6;
    }
    
    body.light & {
      background-color: #f8fafc;
      border-color: #cbd5e1;
      color: #0f172a;
      
      &:focus {
        border-color: #3b82f6;
        box-shadow: 0 0 0 1px #3b82f6;
      }
    }
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
    color: #94a3b8;
    border: 1px solid #1e293b;
    padding: 8px 16px;
    border-radius: var(--border-radius-sm);
    cursor: pointer;
    transition: all 0.2s ease-in-out;
    
    &:hover {
      color: #e2e8f0;
      border-color: #334155;
    }
    
    body.light & {
      border-color: #cbd5e1;
      color: #475569;
      
      &:hover {
        color: #0f172a;
        border-color: #94a3b8;
      }
    }
  `,
  modalSubmitButton: css`
    background-color: #2563eb;
    color: #ffffff;
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    padding: 8px 16px;
    border: none;
    border-radius: var(--border-radius-sm);
    transition: background-color 0.2s ease-in-out;
    cursor: pointer;

    &:hover {
      background-color: #3b82f6;
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
  integrationSelect: css`
    flex: 1;
    background-color: #193549;
    border: 1px solid #1e3a5f;
    border-radius: var(--border-radius-sm);
    padding: 8px;
    font-size: var(--font-size-xs);
    color: #e2e8f0;
    outline: none;
    cursor: pointer;
    transition: border-color 0.15s;

    &:focus { border-color: #3b82f6; }
    &:disabled { opacity: 0.5; cursor: not-allowed; }

    body.light & {
      background-color: #f8fafc;
      border-color: #cbd5e1;
      color: #0f172a;
    }
  `,
  refreshBtn: css`
    background-color: #1e293b;
    border: 1px solid #334155;
    border-radius: var(--border-radius-sm);
    padding: 7px 8px;
    cursor: pointer;
    color: #94a3b8;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s, background-color 0.15s;

    &:hover:not(:disabled) { color: #f1f5f9; background-color: #334155; }
    &:disabled { opacity: 0.4; cursor: not-allowed; }

    body.light & {
      background-color: #f8fafc;
      border-color: #cbd5e1;
      &:hover:not(:disabled) { background-color: #f1f5f9; color: #0f172a; }
    }
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
    color: #fb7185;
    margin-top: 4px;
  `,
};
