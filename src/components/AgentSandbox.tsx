import React, { useState, useEffect } from 'react';
import { css, cx } from '@emotion/css';
import { useDashboard } from '../context/DashboardContext';
import { Agent } from '../types';
import { 
  Bot, 
  Brain, 
  Play, 
  Trash2, 
  Copy, 
  Sparkles, 
  AlertCircle, 
  RefreshCw, 
  MessageSquare
} from 'lucide-react';

interface SandboxMessage {
  id: string;
  sender: 'User' | string; // 'User' or Agent Name
  content: string;
  timestamp: string;
  color: string;
  isAgent: boolean;
}

export const AgentSandbox: React.FC = () => {
  const { agents, settings, showToast, addSavedPrompt } = useDashboard();
  
  // Ollama & LLM States
  const [ollamaStatus, setOllamaStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [provider, setProvider] = useState<'ollama' | 'openai' | 'anthropic'>('ollama');
  
  // Sandbox Configuration States
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [turns, setTurns] = useState<number>(2);
  const [inputText, setInputText] = useState<string>('');
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [currentTurnIndex, setCurrentTurnIndex] = useState<number>(0);
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);
  
  // Message Feed
  const [messages, setMessages] = useState<SandboxMessage[]>([]);

  // Auto-detect Ollama on mount and whenever host settings change
  const checkOllama = async () => {
    setOllamaStatus('checking');
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${settings.ollamaHost}/api/tags`, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (res.ok) {
        const data = await res.json();
        const list = data.models?.map((m: any) => m.name) || [];
        setModels(list);
        setOllamaStatus('online');
        setProvider('ollama');
        if (list.length > 0) {
          setSelectedModel(list[0]);
        }
      } else {
        setOllamaStatus('offline');
        selectCloudFallback();
      }
    } catch (err) {
      setOllamaStatus('offline');
      selectCloudFallback();
    }
  };

  const selectCloudFallback = () => {
    if (settings.anthropicApiKey) {
      setProvider('anthropic');
      setSelectedModel('claude-3-5-sonnet-20241022');
    } else if (settings.openaiApiKey) {
      setProvider('openai');
      setSelectedModel('gpt-4o');
    } else {
      setProvider('ollama'); // Default fallback placeholder
    }
  };

  useEffect(() => {
    checkOllama();
  }, [settings.ollamaHost]);

  // Seed the first two agents as selected once — only on initial load.
  // Must NOT re-run when selectedAgentIds changes, otherwise unchecking the
  // last agent immediately re-seeds the list (the exact bug reported).
  const seededRef = React.useRef(false);
  useEffect(() => {
    if (!seededRef.current && agents.length > 0) {
      seededRef.current = true;
      setSelectedAgentIds(agents.slice(0, 2).map(a => a.id));
    }
  }, [agents]);

  const handleToggleAgent = (agentId: string) => {
    setSelectedAgentIds(prev => 
      prev.includes(agentId) 
        ? prev.filter(id => id !== agentId)
        : [...prev, agentId]
    );
  };

  // Helper to sleep between turns for typing effect and natural flow pacing
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // Call target model API
  const queryLLM = async (
    systemPrompt: string, 
    userPrompt: string, 
    conversationHistory: SandboxMessage[]
  ): Promise<string> => {
    if (provider === 'ollama') {
      const formattedHistory = conversationHistory.map(m => ({
        role: m.sender === 'User' ? 'user' : 'assistant',
        content: m.sender === 'User' ? m.content : `[As ${m.sender}]: ${m.content}`
      }));

      const response = await fetch(`${settings.ollamaHost}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            { role: 'system', content: systemPrompt },
            ...formattedHistory,
            { role: 'user', content: userPrompt }
          ],
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
      }
      const data = await response.json();
      return data.message?.content || 'No response generated.';
    } 
    
    else if (provider === 'openai') {
      if (!settings.openaiApiKey) throw new Error('OpenAI API Key is missing in Settings');
      
      const formattedHistory = conversationHistory.map(m => ({
        role: m.sender === 'User' ? 'user' : 'assistant',
        content: m.sender === 'User' ? m.content : `[As ${m.sender}]: ${m.content}`
      }));

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.openaiApiKey}`
        },
        body: JSON.stringify({
          model: selectedModel || 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            ...formattedHistory,
            { role: 'user', content: userPrompt }
          ]
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }
      const data = await response.json();
      return data.choices?.[0]?.message?.content || 'No response generated.';
    } 
    
    else if (provider === 'anthropic') {
      if (!settings.anthropicApiKey) throw new Error('Anthropic API Key is missing in Settings');
      
      // Build context string from conversation history and append to the user turn.
      // Since multiple agents can respond back-to-back (both as "assistant" roles),
      // we fold the history into a single user message so the Anthropic API receives
      // a valid alternating user/assistant sequence (just one user turn here).
      const historyText = conversationHistory.length > 0
        ? conversationHistory.map(m => `[${m.sender}]: ${m.content}`).join('\n\n')
        : '';
      const fullUserContent = historyText
        ? `Previous conversation:\n${historyText}\n\nYour turn: ${userPrompt}`
        : userPrompt;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': settings.anthropicApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: selectedModel || 'claude-3-5-sonnet-20241022',
          system: systemPrompt,
          max_tokens: 1024,
          messages: [
            { role: 'user', content: fullUserContent }
          ]
        })
      });

      if (!response.ok) {
        throw new Error(`Anthropic API error: ${response.statusText}`);
      }
      const data = await response.json();
      return data.content?.[0]?.text || 'No response generated.';
    }

    throw new Error('Unsupported provider configured');
  };

  const handleStartSimulation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) {
      showToast('Please enter a simulation prompt/topic', 'error');
      return;
    }
    if (selectedAgentIds.length === 0) {
      showToast('Select at least one agent to participate', 'error');
      return;
    }
    if (isSimulating) return;

    setIsSimulating(true);
    setCurrentTurnIndex(0);

    const activeAgents = selectedAgentIds
      .map(id => agents.find(a => a.id === id))
      .filter((a): a is Agent => !!a);

    // Initial User Prompt Message
    const userMsg: SandboxMessage = {
      id: crypto.randomUUID(),
      sender: 'User',
      content: inputText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      color: '#A7B2C1',
      isAgent: false
    };

    const currentMessages = [userMsg];
    setMessages(currentMessages);
    setInputText('');

    let activeHistory = [...currentMessages];

    // Simulation loop
    for (let turn = 0; turn < turns; turn++) {
      setCurrentTurnIndex(turn + 1);
      const agent = activeAgents[turn % activeAgents.length];
      setActiveSpeaker(agent.name);
      
      // Small delay to simulate typing
      await sleep(1200);

      const systemPrompt = `You are simulating the coding agent persona named "${agent.name}".
Your background, specialty, and role details:
${agent.bestUsedFor}

Instructions:
- Respond to the query from the perspective of "${agent.name}".
- Be highly professional, technical, and constructive.
- Speak in the first person ("I").
- Do not add meta-commentary about you being an AI. Stay in character.`;

      const userPrompt = turn === 0 
        ? `We are beginning a brainstorming session. The topic is: "${userMsg.content}". Provide your initial outline, architectural design thoughts, or proposed code implementation.`
        : `Review the preceding discussion regarding "${userMsg.content}". Specially look at the latest response from your colleague. Provide a critique, suggestions for improvements, or build upon their solution from your perspective.`;

      try {
        const reply = await queryLLM(systemPrompt, userPrompt, activeHistory);

        const agentMsg: SandboxMessage = {
          id: crypto.randomUUID(),
          sender: agent.name,
          content: reply,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          color: agent.color || '#3b82f6',
          isAgent: true
        };

        currentMessages.push(agentMsg);
        setMessages([...currentMessages]);
        activeHistory.push(agentMsg);
      } catch (err: any) {
        console.error(err);
        showToast(`Simulation error during ${agent.name}'s turn: ${err.message || err}`, 'error');
        
        // Push error message
        currentMessages.push({
          id: crypto.randomUUID(),
          sender: 'System Warning',
          content: `Failed to fetch response for ${agent.name}: ${err.message || err}. Make sure Ollama or cloud keys are correctly configured.`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          color: '#ef4444',
          isAgent: false
        });
        setMessages([...currentMessages]);
        break; // Break the simulation on failure
      }
    }

    setIsSimulating(false);
    setActiveSpeaker(null);
    showToast('Simulation workflow complete!', 'success');
  };

  const handleClearHistory = () => {
    setMessages([]);
    showToast('Sandbox history cleared', 'info');
  };

  const handleCopyTranscript = () => {
    if (messages.length === 0) return;
    const text = messages.map(m => `[${m.timestamp}] ${m.sender}:\n${m.content}\n`).join('\n---\n\n');
    navigator.clipboard.writeText(text);
    showToast('Sandbox transcript copied to clipboard!', 'success');
  };

  const handleSaveToVault = () => {
    if (messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    addSavedPrompt({
      workspaceId: '',
      agentId: '',
      title: `Sandbox Output - ${new Date().toLocaleDateString()}`,
      content: lastMsg.content,
      tags: ['sandbox', 'simulation']
    });
  };

  return (
    <div className={styles.root}>
      {/* Sidebar Controls & Feed Split */}
      <div className={styles.innerContainer}>
        
        {/* Left Side: Simulation Controls */}
        <div className={styles.sidebar}>
          <div className={styles.sidebarStack}>
            
            {/* Header */}
            <div>
              <h3 className={styles.sidebarTitle}>
                <Brain className={styles.sidebarHeaderIcon} />
                <span>Simulation Setup</span>
              </h3>
              <p className={styles.sidebarDesc}>
                Run local agent debate simulations using Ollama or configured cloud API keys.
              </p>
            </div>

            {/* Provider Settings */}
            <div className={styles.controlGroup}>
              <label className={styles.label}>AI Model Provider</label>
              <div className={styles.providerGrid}>
                <button
                  type="button"
                  onClick={() => setProvider('ollama')}
                  className={cx(styles.providerBtn, provider === 'ollama' && styles.providerBtnActive)}
                >
                  Ollama
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setProvider('openai');
                    setSelectedModel('gpt-4o');
                  }}
                  className={cx(styles.providerBtn, provider === 'openai' && styles.providerBtnActive)}
                >
                  OpenAI
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setProvider('anthropic');
                    setSelectedModel('claude-3-5-sonnet-20241022');
                  }}
                  className={cx(styles.providerBtn, provider === 'anthropic' && styles.providerBtnActive)}
                >
                  Claude
                </button>
              </div>
            </div>

            {/* Model Select */}
            <div className={styles.controlGroup}>
              <div className={styles.modelHeader}>
                <label className={styles.label}>Active LLM Model</label>
                <button 
                  onClick={checkOllama} 
                  className={styles.reloadBtn}
                  title="Reload Models"
                >
                  <RefreshCw className={styles.reloadIcon} />
                </button>
              </div>

              {provider === 'ollama' ? (
                ollamaStatus === 'online' ? (
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className={styles.select}
                  >
                    {models.map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                ) : (
                  <div className={styles.offlineAlert}>
                    <AlertCircle className={styles.alertIcon} />
                    <span>Ollama offline at {settings.ollamaHost}. Toggle OpenAI/Claude or run local Ollama server.</span>
                  </div>
                )
              ) : (
                <input
                  type="text"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  placeholder="e.g. gpt-4o, claude-3-5-sonnet"
                  className={styles.input}
                />
              )}
            </div>

            {/* Turn Count & Parameters */}
            <div className={styles.controlGroup}>
              <label className={styles.label}>Simulation Turns</label>
              <select
                value={turns}
                onChange={(e) => setTurns(Number(e.target.value))}
                className={styles.select}
              >
                <option value={1}>1 Turn (Single Response)</option>
                <option value={2}>2 Turns (Review & Critique)</option>
                <option value={3}>3 Turns (Debate Flow)</option>
                <option value={4}>4 Turns (Deep Refinement)</option>
                <option value={5}>5 Turns (Consensus Search)</option>
              </select>
            </div>

            {/* Participant Checklist */}
            <div className={styles.controlGroup}>
              <label className={styles.label}>Agent Registry Participants</label>
              <div className={styles.registryList}>
                {agents.map((agent) => (
                  <label
                    key={agent.id}
                    className={styles.registryItem}
                  >
                    <div className={styles.registryItemLeft}>
                      <input
                        type="checkbox"
                        checked={selectedAgentIds.includes(agent.id)}
                        onChange={() => handleToggleAgent(agent.id)}
                        disabled={isSimulating}
                        className={styles.checkbox}
                      />
                      <span className={styles.agentName}>{agent.name}</span>
                    </div>
                    <span 
                      className={styles.colorDot} 
                      style={{ backgroundColor: agent.color || '#3b82f6' }}
                    />
                  </label>
                ))}
                {agents.length === 0 && (
                  <p className={styles.emptyText}>No agents registered.</p>
                )}
              </div>
            </div>

          </div>

          {/* Bottom Actions */}
          <div className={styles.sidebarActions}>
            <button
              onClick={handleClearHistory}
              disabled={messages.length === 0 || isSimulating}
              className={styles.actionBtn}
            >
              <Trash2 className={styles.trashIcon} />
              <span>Clear History</span>
            </button>
            <div className={styles.halfActionsGrid}>
              <button
                onClick={handleCopyTranscript}
                disabled={messages.length === 0}
                className={styles.halfActionBtn}
                title="Copy Transcript"
              >
                <Copy className={styles.copyIcon} />
                <span>Copy</span>
              </button>
              <button
                onClick={handleSaveToVault}
                disabled={messages.length === 0 || isSimulating}
                className={styles.halfActionBtn}
                title="Save last message to Prompt Vault"
              >
                <Sparkles className={styles.saveIcon} />
                <span>Save Code</span>
              </button>
            </div>
          </div>

        </div>

        {/* Right Side: Message Feed */}
        <div className={styles.feedPane}>
          
          {/* Header */}
          <div className={styles.feedHeader}>
            <div className={styles.feedHeaderLeft}>
              <MessageSquare className={styles.feedHeaderIcon} />
              <span className={styles.feedHeaderTitle}>Simulation Feed</span>
            </div>
            {isSimulating && (
              <div className={styles.statusIndicator}>
                <span className={styles.statusDotContainer}>
                  <span className={styles.statusDotPing}></span>
                  <span className={styles.statusDotInner}></span>
                </span>
                <span>
                  {activeSpeaker ? `${activeSpeaker} is typing...` : 'Processing...'} (Turn {currentTurnIndex}/{turns})
                </span>
              </div>
            )}
          </div>

          {/* Feed Container */}
          <div className={styles.feedContainer}>
            {messages.length === 0 ? (
              <div className={styles.emptyFeed}>
                <Bot className={styles.emptyFeedIcon} />
                <div>
                  <h4 className={styles.emptyFeedTitle}>Sandbox Empty</h4>
                  <p className={styles.emptyFeedDesc}>
                    Draft a coding task or workflow architecture design topic at the bottom to watch your selected agents critique and shape it.
                  </p>
                </div>
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={styles.messageCard}
                  style={m.isAgent ? { borderLeft: `3px solid ${m.color}` } : {}}
                >
                  {/* Sender & Timestamp Header */}
                  <div className={styles.msgHeader}>
                    <div className={styles.msgHeaderLeft}>
                      {m.isAgent ? (
                        <Bot className={styles.msgBotIcon} style={{ color: m.color }} />
                      ) : (
                        <div className={styles.msgUserDot} />
                      )}
                      <span className={styles.msgSenderName} style={{ color: m.color }}>
                        {m.sender}
                      </span>
                    </div>
                    <span className={styles.msgTimestamp}>{m.timestamp}</span>
                  </div>

                  {/* Body Content */}
                  <div className={styles.msgContent}>
                    {m.content}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Topic Entry Footer Form */}
          <div className={styles.footerFormContainer}>
            <form onSubmit={handleStartSimulation} className={styles.footerForm}>
              <input
                type="text"
                placeholder={
                  isSimulating 
                    ? "Simulation in progress, please wait..." 
                    : "Enter starting topic, task request, or prompt code here..."
                }
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                disabled={isSimulating}
                className={styles.footerInput}
              />
              <button
                type="submit"
                disabled={isSimulating || !inputText.trim() || selectedAgentIds.length === 0}
                className={styles.submitBtn}
              >
                {isSimulating ? (
                  <>
                    <RefreshCw className={styles.spinIcon} />
                    <span>Running...</span>
                  </>
                ) : (
                  <>
                    <Play className={styles.playIcon} />
                    <span>Simulate</span>
                  </>
                )}
              </button>
            </form>
          </div>

        </div>

      </div>
    </div>
  );
};

const styles = {
  root: css`
    display: flex;
    flex-direction: column;
    height: 100%;
    background-color: var(--bg-primary);
    color: var(--text-primary);
  `,
  innerContainer: css`
    display: flex;
    flex: 1 1 0%;
    overflow: hidden;
    min-height: 0;
  `,
  sidebar: css`
    width: 320px;
    border-right: 1px solid var(--border-color);
    background-color: var(--bg-secondary);
    padding: 20px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    overflow-y: auto;
    flex-shrink: 0;
    user-select: none;
  `,
  sidebarStack: css`
    display: flex;
    flex-direction: column;
    gap: 24px;
  `,
  sidebarTitle: css`
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-bold);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-brand);
    display: flex;
    align-items: center;
    gap: 8px;
  `,
  sidebarHeaderIcon: css`
    width: 18px;
    height: 18px;
    color: var(--color-brand);
  `,
  sidebarDesc: css`
    font-size: 11px;
    color: var(--text-tertiary);
    margin-top: 4px;
    line-height: 1.625;
  `,
  controlGroup: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  label: css`
    display: block;
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--text-secondary);
  `,
  providerGrid: css`
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4px;
    padding: 4px;
    background-color: var(--bg-primary);
    border-radius: var(--border-radius-md);
    border: 1px solid var(--border-color);
  `,
  providerBtn: css`
    font-size: 10px;
    padding: 4px 8px;
    border-radius: var(--border-radius-sm);
    font-weight: var(--font-weight-bold);
    transition: all 0.2s ease-in-out;
    border: none;
    background: transparent;
    cursor: pointer;
    color: var(--text-secondary);
    display: inline-flex;
    align-items: center;
    justify-content: center;

    &:hover {
      color: var(--text-primary);
    }
  `,
  providerBtnActive: css`
    background-color: var(--color-brand);
    color: var(--text-inverse);

    &:hover {
      color: var(--text-inverse);
    }
  `,
  modelHeader: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  reloadBtn: css`
    padding: 4px;
    color: var(--text-secondary);
    background: transparent;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s ease-in-out;

    &:hover {
      color: var(--text-primary);
    }
  `,
  reloadIcon: css`
    width: 12px;
    height: 12px;
  `,
  select: css`
    width: 100%;
    background-color: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md);
    padding: 8px;
    font-size: var(--font-size-xs);
    color: var(--text-primary);
    outline: none;
    transition: border-color 0.15s ease-in-out;

    &:focus {
      border-color: var(--color-brand);
    }
  `,
  offlineAlert: css`
    padding: 8px;
    border-radius: var(--border-radius-md);
    background-color: rgba(var(--color-error-rgb), 0.1);
    border: 1px solid rgba(var(--color-error-rgb), 0.25);
    color: var(--color-error);
    font-size: 10px;
    line-height: 1.625;
    display: flex;
    align-items: center;
    gap: 6px;
  `,
  alertIcon: css`
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  `,
  input: css`
    width: 100%;
    background-color: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md);
    padding: 8px;
    font-size: var(--font-size-xs);
    color: var(--text-primary);
    outline: none;
    transition: border-color 0.15s ease-in-out;

    &::placeholder {
      color: var(--text-tertiary);
    }

    &:focus {
      border-color: var(--color-brand);
    }
  `,
  registryList: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 192px;
    overflow-y: auto;
    padding-right: 4px;
  `,
  registryItem: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px;
    border-radius: var(--border-radius-sm);
    background-color: var(--bg-primary);
    border: 1px solid var(--border-color);
    cursor: pointer;
    transition: all 0.2s ease-in-out;
    font-size: var(--font-size-xs);

    &:hover {
      border-color: var(--color-brand);
    }
  `,
  registryItemLeft: css`
    display: flex;
    align-items: center;
    gap: 8px;
  `,
  checkbox: css`
    border-radius: 4px;
    border: 1px solid var(--border-color);
    background-color: var(--bg-secondary);
    accent-color: var(--color-brand);
    cursor: pointer;
    width: 14px;
    height: 14px;
  `,
  agentName: css`
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  `,
  colorDot: css`
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  `,
  emptyText: css`
    font-size: 10px;
    color: var(--text-tertiary);
    font-style: italic;
  `,
  sidebarActions: css`
    padding-top: 16px;
    border-top: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  actionBtn: css`
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background-color: var(--bg-primary);
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md);
    padding: 8px 12px;
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    cursor: pointer;
    transition: all 0.15s ease-in-out;

    &:hover:not(:disabled) {
      background-color: var(--bg-hover);
      color: var(--text-primary);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `,
  trashIcon: css`
    width: 14px;
    height: 14px;
    color: var(--color-error);
  `,
  halfActionsGrid: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  `,
  halfActionBtn: css`
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    background-color: var(--bg-primary);
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md);
    padding: 8px;
    font-size: 10px;
    font-weight: var(--font-weight-bold);
    cursor: pointer;
    transition: all 0.15s ease-in-out;

    &:hover:not(:disabled) {
      background-color: var(--bg-hover);
      color: var(--text-primary);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `,
  copyIcon: css`
    width: 12px;
    height: 12px;
    color: rgb(var(--color-info-rgb));
  `,
  saveIcon: css`
    width: 12px;
    height: 12px;
    color: var(--color-brand);
  `,
  feedPane: css`
    flex: 1 1 0%;
    display: flex;
    flex-direction: column;
    background-color: var(--bg-primary);
  `,
  feedHeader: css`
    padding: 16px 24px;
    border-bottom: 1px solid var(--border-color);
    background-color: var(--bg-secondary);
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  feedHeaderLeft: css`
    display: flex;
    align-items: center;
    gap: 8px;
  `,
  feedHeaderIcon: css`
    width: 16px;
    height: 16px;
    color: var(--color-brand);
  `,
  feedHeaderTitle: css`
    font-weight: var(--font-weight-bold);
    font-size: var(--font-size-base);
    color: var(--text-primary);
  `,
  statusIndicator: css`
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-brand);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
  `,
  statusDotContainer: css`
    position: relative;
    display: flex;
    width: 8px;
    height: 8px;
  `,
  statusDotPing: css`
    position: absolute;
    display: inline-flex;
    height: 100%;
    width: 100%;
    border-radius: 50%;
    background-color: var(--color-brand);
    opacity: 0.75;
    animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite;

    @keyframes ping {
      75%, 100% {
        transform: scale(2);
        opacity: 0;
      }
    }
  `,
  statusDotInner: css`
    position: relative;
    display: inline-flex;
    border-radius: 50%;
    height: 8px;
    width: 8px;
    background-color: var(--color-brand);
  `,
  feedContainer: css`
    flex: 1 1 0%;
    overflow-y: auto;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  `,
  emptyFeed: css`
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: var(--text-tertiary);
    padding: 32px;
    gap: 12px;
  `,
  emptyFeedIcon: css`
    width: 48px;
    height: 48px;
    color: var(--color-brand);
    opacity: 0.4;
  `,
  emptyFeedTitle: css`
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
  `,
  emptyFeedDesc: css`
    font-size: var(--font-size-xs);
    max-width: 384px;
    margin-top: 4px;
    color: var(--text-secondary);
  `,
  messageCard: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 16px;
    border-radius: var(--border-radius-lg);
    border: 1px solid var(--border-color);
    background-color: var(--bg-secondary);
    box-shadow: var(--shadow-sm);
  `,
  msgHeader: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  msgHeaderLeft: css`
    display: flex;
    align-items: center;
    gap: 8px;
  `,
  msgBotIcon: css`
    width: 14px;
    height: 14px;
  `,
  msgUserDot: css`
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background-color: var(--color-secondary);
  `,
  msgSenderName: css`
    font-weight: 800;
    font-size: var(--font-size-xs);
    letter-spacing: 0.025em;
  `,
  msgTimestamp: css`
    font-size: 9px;
    color: var(--text-tertiary);
    font-weight: var(--font-weight-medium);
  `,
  msgContent: css`
    font-size: var(--font-size-xs);
    color: var(--text-primary);
    line-height: 1.625;
    font-family: var(--font-family-mono);
    white-space: pre-wrap;
    user-select: text;

    &::selection {
      background-color: #9effff;
      color: #0d2131;
    }
  `,
  footerFormContainer: css`
    padding: 16px;
    border-top: 1px solid var(--border-color);
    background-color: var(--bg-secondary);
  `,
  footerForm: css`
    display: flex;
    gap: 8px;
  `,
  footerInput: css`
    flex: 1 1 0%;
    background-color: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md);
    padding: 8px 16px;
    font-size: var(--font-size-xs);
    color: var(--text-primary);
    outline: none;
    transition: border-color 0.15s ease-in-out;

    &::placeholder {
      color: var(--text-tertiary);
    }

    &:focus {
      border-color: var(--color-brand);
    }

    &:disabled {
      opacity: 0.5;
    }
  `,
  submitBtn: css`
    display: flex;
    align-items: center;
    gap: 6px;
    background-color: var(--color-brand);
    color: var(--text-inverse);
    font-weight: var(--font-weight-bold);
    padding: 8px 16px;
    border-radius: var(--border-radius-md);
    font-size: var(--font-size-xs);
    transition: all 0.15s ease-in-out;
    cursor: pointer;
    border: none;
    flex-shrink: 0;

    &:hover:not(:disabled) {
      filter: brightness(1.1);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `,
  spinIcon: css`
    width: 14px;
    height: 14px;
    animation: spin 1s linear infinite;

    @keyframes spin {
      from {
        transform: rotate(0deg);
      }
      to {
        transform: rotate(360deg);
      }
    }
  `,
  playIcon: css`
    width: 14px;
    height: 14px;
    fill: currentColor;
  `
};
