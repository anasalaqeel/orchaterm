/**
 * GroupChat.tsx
 *
 * Streaming Ollama chat panel scoped to the active Space.
 *
 * Features:
 * - Streaming chat with Ollama (stale-closure fix via streamingContentRef)
 * - Chat history persisted to localStorage per workspace/space
 * - Live terminal feed: watchForSummary → summariseChunk → agent-summary messages
 * - Terminal injection: parses "INJECT → <title>: <msg>" from Ollama, calls write_pty
 * - Save message to Prompt Vault
 * - Export transcript as .md
 * - Contextual empty state with suggested prompts
 * - Inline Markdown rendering (code fences, bold, inline code)
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { css, cx } from '@emotion/css';
import {
  Send, Bot, User, WifiOff, RefreshCw, Users,
  ChevronDown, BookmarkPlus, Download, X as XIcon, SlidersHorizontal, Check,
  MessageSquare, Network, Info,
} from 'lucide-react';
import { WorkspacePanel } from './WorkspacePanel';
import { Select } from './Select';
import { useDashboard } from '../../context/DashboardContext';
import { writePtyChunked } from '../../utils/ptyUtils';
import {
  buildPlanGenPrompt,
  buildSummarisePrompt,
  buildIntentClassifyPrompt,
  parsePlanGenResponse,
  RawPlanTask,
} from '../../services/ollamaRelay';
import type { ChatMessage } from '../../services/llm/types';
import { bufferWatcher } from '../../services/bufferWatcher';
import { stripAnsiCodes } from '../../services/sentinelParser';
import { needsBroker } from '../../services/needsBroker';
import { autonomousOrchestrator } from '../../services/autonomousOrchestrator';
import { orchestratorEngine } from '../../services/orchestratorEngine';
import type { OrchestratorTask, OrchestratorPlan, ConductorLogEntry } from '../../types';

// ── Props ──────────────────────────────────────────────────────────────────────

interface GroupChatProps {
  workspaceId: string;
}

// ── Display message ────────────────────────────────────────────────────────────

type MsgRole = 'user' | 'assistant' | 'system' | 'agent-summary' | 'conductor';

interface DisplayMessage {
  id: string;
  role: MsgRole;
  content: string;
  streaming?: boolean;
  sessionTitle?: string;
  sessionColor?: string | null;
  injectedSessionTitle?: string;
  /** Set on 'conductor' messages — controls icon and colour. */
  conductorType?: ConductorLogEntry['type'];
  /** Full task output — present on sentinel conductor messages. */
  taskOutput?: ConductorLogEntry['taskOutput'];
  /** Agent title — present on sentinel conductor messages. */
  agentTitle?: string;
}

/** Pending plan awaiting user confirmation before starting. */
interface PendingPlan {
  goal: string;
  tasks: OrchestratorTask[];
}

// ── Storage helpers ────────────────────────────────────────────────────────────

const MAX_STORED = 100;

function chatStorageKey(workspaceId: string, spaceId: string | null): string {
  return `orchaterm:chat:${workspaceId}:${spaceId ?? 'workspace'}`;
}

function loadPersistedMessages(key: string): DisplayMessage[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveMessages(key: string, messages: DisplayMessage[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(messages.slice(-MAX_STORED)));
  } catch { /* storage full — ignore */ }
}

// ── Inline Markdown renderer ───────────────────────────────────────────────────

function renderMarkdown(text: string): React.ReactNode {
  // Split on code fences
  const parts = text.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const inner = part.slice(3, -3).replace(/^\w+\n/, '');
          return (
            <pre key={i} className={md.codeBlock}>{inner}</pre>
          );
        }
        // Inline: **bold**, `code`
        const segments = part.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
        return (
          <span key={i}>
            {segments.map((seg, j) => {
              if (seg.startsWith('**') && seg.endsWith('**'))
                return <strong key={j} className={md.bold}>{seg.slice(2, -2)}</strong>;
              if (seg.startsWith('`') && seg.endsWith('`'))
                return <code key={j} className={md.inlineCode}>{seg.slice(1, -1)}</code>;
              return seg;
            })}
          </span>
        );
      })}
    </>
  );
}

const md = {
  codeBlock: css`
    background: rgba(0,0,0,0.35); border-radius: 6px; padding: 8px 10px;
    margin: 6px 0; font-family: 'Fira Code','Cascadia Code',monospace;
    font-size: 11px; overflow-x: auto; white-space: pre; color: #94a3b8;
  `,
  bold: css`color: #e2e8f0;`,
  inlineCode: css`
    background: rgba(0,0,0,0.3); border-radius: 3px; padding: 1px 5px;
    font-family: 'Fira Code',monospace; font-size: 0.9em; color: #f59e0b;
  `,
};

// ── System prompt ──────────────────────────────────────────────────────────────

function buildSystemPrompt(
  workspaceName: string,
  spaceName: string | null,
  sessionTitles: string[],
): string {
  const spaceLine = spaceName
    ? `Active Space: "${spaceName}"`
    : 'No space is currently selected.';
  const sessionsLine = sessionTitles.length > 0
    ? `Terminal sessions in this space:\n${sessionTitles.map(t => `  • ${t}`).join('\n')}`
    : 'No terminal sessions are currently assigned to this space.';

  return `You are an AI orchestration assistant embedded inside Orchaterm, a developer workspace management tool.

Workspace: "${workspaceName}"
${spaceLine}
${sessionsLine}

Your job: help the developer plan, coordinate, and execute work across their terminal sessions. Be concise, direct, and practical. Think like a senior engineer and a tech lead — not a chatbot. Avoid filler, avoid markdown headers, keep answers short unless depth is needed.

When the developer asks you to send a message or instruction to a specific terminal session, include an injection line in your response formatted exactly like this:
INJECT → <terminal-title>: <message to send>

Only use INJECT when the user explicitly asks you to send/relay something to a terminal. You can include your normal reply above or below the INJECT line.`;
}

// ── Inject parser ──────────────────────────────────────────────────────────────

function parseInject(
  content: string,
  sessions: { id: string; title: string; color: string | null }[],
): { sessionId: string; sessionTitle: string; sessionColor: string | null; message: string } | null {
  const match = content.match(/INJECT\s*→\s*([^:\n]+):\s*(.+)/i);
  if (!match) return null;
  const targetTitle = match[1].trim();
  const message     = match[2].trim();
  const session = sessions.find(
    s => s.title.toLowerCase().includes(targetTitle.toLowerCase()),
  );
  if (!session) return null;
  return { sessionId: session.id, sessionTitle: session.title, sessionColor: session.color, message };
}

// ── Suggested prompts ──────────────────────────────────────────────────────────

function getSuggestions(sessionTitles: string[]): string[] {
  const first = sessionTitles[0] ?? 'the terminal';
  return [
    'What is everyone working on right now?',
    `Summarise what ${first} has done so far`,
    `Tell ${first} to write a brief status update`,
  ];
}

// ── Component ──────────────────────────────────────────────────────────────────

export const GroupChat: React.FC<GroupChatProps> = ({ workspaceId }) => {
  const {
    workspaces, spaces, terminalSessions,
    activeSpaceId, settings, addSavedPrompt, showToast, addPlan, llmProviders,
  } = useDashboard();

  const workspace     = workspaces.find(w => w.id === workspaceId);
  const activeSpace   = spaces.find(g => g.id === activeSpaceId);
  const allSessions   = terminalSessions.filter(s => s.workspaceId === workspaceId);
  const groupSessions = activeSpace
    ? allSessions.filter(s => activeSpace.sessionIds.includes(s.id))
    : allSessions;

  // ── Storage key — changes when space changes ──────────────────────────────
  const storageKey    = chatStorageKey(workspaceId, activeSpaceId ?? null);
  const storageKeyRef = useRef(storageKey);

  // ── Ollama status ─────────────────────────────────────────────────────────
  const [ollamaOnline, setOllamaOnline] = useState<boolean | null>(null);
  const [checking, setChecking]         = useState(false);

  const checkOnline = useCallback(async () => {
    setChecking(true);
    const ok = await llmProviders.chat.checkOnline();
    setOllamaOnline(ok);
    setChecking(false);
  }, [llmProviders.chat]);

  useEffect(() => { checkOnline(); }, [checkOnline]);

  // ── Message history (persisted) ───────────────────────────────────────────
  const [messages,   setMessages]   = useState<DisplayMessage[]>(() => loadPersistedMessages(storageKey));
  const [apiHistory, setApiHistory] = useState<ChatMessage[]>([]);
  const [input,      setInput]      = useState('');
  const [streaming,  setStreaming]  = useState(false);

  // ── Plan mode state ───────────────────────────────────────────────────────
  const [pendingPlan,    setPendingPlan]    = useState<PendingPlan | null>(null);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [livePlan,       setLivePlan]       = useState<OrchestratorPlan | null>(null);

  // ── Input mode (chat vs manual pipeline builder) ──────────────────────────
  const [inputMode,      setInputMode]      = useState<'chat' | 'pipeline'>('chat');
  const [buildTitle,     setBuildTitle]     = useState('');
  const [buildSessionId, setBuildSessionId] = useState('');
  const [buildTasks,     setBuildTasks]     = useState<OrchestratorTask[]>([]);

  // ── Workspace info panel ──────────────────────────────────────────────────
  const [showWorkspaceInfo, setShowWorkspaceInfo] = useState(false);

  // ── Features popover ─────────────────────────────────────────────────────
  const [featuresOpen,   setFeaturesOpen]   = useState(false);
  const featuresRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!featuresOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (featuresRef.current && !featuresRef.current.contains(e.target as Node)) {
        setFeaturesOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [featuresOpen]);

  // Tracks streaming content so onDone never needs to read state
  const streamingContentRef = useRef('');
  const cancelRef           = useRef<(() => void) | null>(null);
  const bottomRef           = useRef<HTMLDivElement>(null);
  const textareaRef         = useRef<HTMLTextAreaElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  // Persist on every message change (debounced 300 ms)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveMessages(storageKeyRef.current, messages), 300);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [messages]);

  // Swap persisted history when space changes
  useEffect(() => {
    const newKey = chatStorageKey(workspaceId, activeSpaceId ?? null);
    storageKeyRef.current = newKey;
    setMessages(loadPersistedMessages(newKey));
    setApiHistory([]);
  }, [workspaceId, activeSpaceId]);

  const scrollToBottom = (smooth = true) =>
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' });

  useEffect(() => { if (!streaming) scrollToBottom(); }, [messages.length, streaming]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 120);
  };

  // ── Live feed (watchForSummary) ───────────────────────────────────────────
  const [liveFeedOn, setLiveFeedOn] = useState(
    () => localStorage.getItem('orchaterm:livefeed') === 'true',
  );

  const toggleLiveFeed = () => {
    setLiveFeedOn(prev => {
      localStorage.setItem('orchaterm:livefeed', String(!prev));
      return !prev;
    });
  };

  const [autoModeOn, setAutoModeOn] = useState(
    () => localStorage.getItem('orchaterm:automode') === 'true',
  );

  const toggleAutoMode = () => {
    setAutoModeOn(prev => {
      localStorage.setItem('orchaterm:automode', String(!prev));
      return !prev;
    });
  };

  const groupSessionIds = groupSessions.map(s => s.id).join(',');

  useEffect(() => {
    if (!liveFeedOn) return;

    const unsubscribers: (() => void)[] = [];

    groupSessions.forEach(session => {
      const onChunk = async (chunk: string) => {
        // Skip chunks with no readable content — avoids flooding chat with
        // "output consists entirely of ANSI escape codes" noise messages.
        const readable = stripAnsiCodes(chunk).replace(/\s+/g, ' ').trim();
        if (readable.length < 25) return;

        try {
          const { system, userContent } = buildSummarisePrompt(chunk, session.title);
          const summary = await llmProviders.routing.complete([{ role: 'user', content: userContent }], system);
          setMessages(prev => [...prev, {
            id: crypto.randomUUID(),
            role: 'agent-summary',
            content: summary,
            sessionTitle: session.title,
            sessionColor: session.color,
          }]);
        } catch { /* silently skip */ }
      };

      bufferWatcher.watchForSummary(session.id, onChunk).then(unsub => {
        unsubscribers.push(unsub);
      });
    });

    return () => { unsubscribers.forEach(fn => fn()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveFeedOn, groupSessionIds, llmProviders.routing]);

  // ── NeedsBroker wiring ────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeSpaceId) return;

    needsBroker.registerSpace(activeSpaceId, groupSessions.map(s => ({
      id:              s.id,
      title:           s.title,
      color:           s.color,
      interruptPolicy: s.interruptPolicy ?? 'never',
    })));

    const unsubNeeds: (() => void)[] = [];

    groupSessions.forEach(session => {
      bufferWatcher.watchForNeeds(session.id, async (request) => {
        await needsBroker.handleNeedsRequest(
          session.id,
          activeSpaceId,
          request,
          (_answer) => {
            setMessages(prev => [...prev, {
              id:   crypto.randomUUID(),
              role: 'system' as const,
              content: `🔄 ${session.title} asked: "${request.ask}" → Orchaterm answered`,
            }]);
          },
          (err) => {
            setMessages(prev => [...prev, {
              id:   crypto.randomUUID(),
              role: 'system' as const,
              content: `⚠ Could not resolve ${session.title}'s request: ${err}`,
            }]);
          },
        );
      }).then(unsub => unsubNeeds.push(unsub));
    });

    return () => {
      unsubNeeds.forEach(fn => fn());
      if (activeSpaceId) needsBroker.unregisterSpace(activeSpaceId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSpaceId, groupSessionIds]);

  // ── Autonomous mode effect ────────────────────────────────────────────────
  useEffect(() => {
    if (!autoModeOn || !activeSpaceId) return;

    autonomousOrchestrator.startSpace({
      spaceId:  activeSpaceId,
      sessions: groupSessions.map(s => ({
        id:              s.id,
        title:           s.title,
        color:           s.color,
        interruptPolicy: s.interruptPolicy ?? 'never',
      })),
    });

    // Listen to routing events and show them in the Chat feed
    const unsubEvents = autonomousOrchestrator.onEvent((event) => {
      let content = '';
      if (event.type === 'relayed') {
        content = `⚡ Auto-relayed from ${event.from} → ${event.to}: "${event.message}"`;
      } else if (event.type === 'relay-skipped') {
        content = `⏸ Relay to ${event.target} skipped (${event.reason})`;
      }
      if (content) {
        setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'system' as const, content }]);
      }
    });

    return () => {
      unsubEvents();
      autonomousOrchestrator.stopSpace(activeSpaceId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoModeOn, activeSpaceId, groupSessionIds]);

  // ── Conductor engine log + state → chat feed ────────────────────────────
  // Engine is a singleton — subscribe once on mount, never re-subscribe.
  useEffect(() => {
    const unsubLog = orchestratorEngine.onLog((entry) => {
      setMessages(prev => [...prev, {
        id:            crypto.randomUUID(),
        role:          'conductor',
        content:       entry.message,
        conductorType: entry.type,
        taskOutput:    entry.taskOutput,
        agentTitle:    entry.agentTitle,
      }]);
    });
    const unsubState = orchestratorEngine.onStateChange((plan) => {
      setLivePlan({ ...plan });
    });
    // Sync initial state in case a plan is already running
    const existing = orchestratorEngine.getCurrentPlan();
    if (existing) setLivePlan({ ...existing });
    return () => { unsubLog(); unsubState(); };
  }, []);

  // Auto-dismiss livePlan 8s after it reaches a terminal state
  useEffect(() => {
    if (!livePlan || livePlan.status === 'running' || livePlan.status === 'paused') return;
    const timer = setTimeout(() => setLivePlan(null), 8000);
    return () => clearTimeout(timer);
  }, [livePlan]);

  // ── Plan: confirm and start ───────────────────────────────────────────────

  const handleRunPlan = useCallback(() => {
    if (!pendingPlan) return;

    const currentPlan = orchestratorEngine.getCurrentPlan();
    if (currentPlan?.status === 'running' || currentPlan?.status === 'paused') {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(), role: 'system',
        content: '⚠ A plan is already running. Stop it first via the Conductor.',
      }]);
      return;
    }

    const plan: OrchestratorPlan = {
      id:          crypto.randomUUID(),
      goal:        pendingPlan.goal,
      tasks:       pendingPlan.tasks,
      status:      'approved',
      createdAt:   Date.now(),
      workspaceId,
      spaceId:     activeSpaceId ?? null,
    };

    orchestratorEngine.updateConfig({
      relayProvider:      llmProviders.relay,
      planGenProvider:    llmProviders.planGen,
      autoAnswerProvider: llmProviders.autoAnswer,
      taskTimeoutMinutes: settings.conductorTaskTimeoutMinutes,
      interactionMode:    settings.conductorInteractionMode,
      sessionTitles:      new Map(groupSessions.map(s => [s.id, s.title])),
    });

    orchestratorEngine.start(plan);
    addPlan(plan);
    setPendingPlan(null);

    setMessages(prev => [...prev, {
      id: crypto.randomUUID(), role: 'system',
      content: `▶ Plan started — ${plan.tasks.length} task${plan.tasks.length !== 1 ? 's' : ''} dispatched`,
    }]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPlan, activeSpaceId, workspaceId, groupSessions, settings, addPlan, llmProviders]);

  const handleDiscardPlan = useCallback(() => {
    setPendingPlan(null);
    setMessages(prev => [...prev, {
      id: crypto.randomUUID(), role: 'system', content: '✕ Plan discarded',
    }]);
  }, []);

  // ── Pipeline builder (manual mode) ───────────────────────────────────────

  const handleAddBuildTask = useCallback(() => {
    if (!buildTitle.trim() || !buildSessionId) return;
    const session = groupSessions.find(s => s.id === buildSessionId);
    if (!session) return;
    setBuildTasks(prev => [...prev, {
      id:                   crypto.randomUUID(),
      title:                buildTitle.trim(),
      description:          buildTitle.trim(),
      assignedSessionId:    session.id,
      assignedSessionTitle: session.title,
      dependsOn:            [],
      status:               'pending' as const,
    }]);
    setBuildTitle('');
  }, [buildTitle, buildSessionId, groupSessions]);

  const handleRemoveBuildTask = useCallback((id: string) => {
    setBuildTasks(prev => prev.filter(t => t.id !== id));
  }, []);

  const handleRunBuildPlan = useCallback(() => {
    if (buildTasks.length === 0) return;

    const currentPlan = orchestratorEngine.getCurrentPlan();
    if (currentPlan?.status === 'running' || currentPlan?.status === 'paused') {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(), role: 'system',
        content: '⚠ A plan is already running. Stop it first via the Conductor.',
      }]);
      return;
    }

    const plan: OrchestratorPlan = {
      id:          crypto.randomUUID(),
      goal:        buildTasks.map(t => t.title).join(' → '),
      tasks:       buildTasks,
      status:      'approved',
      createdAt:   Date.now(),
      workspaceId,
      spaceId:     activeSpaceId ?? null,
    };

    orchestratorEngine.updateConfig({
      relayProvider:      llmProviders.relay,
      planGenProvider:    llmProviders.planGen,
      autoAnswerProvider: llmProviders.autoAnswer,
      taskTimeoutMinutes: settings.conductorTaskTimeoutMinutes,
      interactionMode:    settings.conductorInteractionMode,
      sessionTitles:      new Map(groupSessions.map(s => [s.id, s.title])),
    });

    orchestratorEngine.start(plan);
    addPlan(plan);
    setBuildTasks([]);

    setMessages(prev => [...prev, {
      id: crypto.randomUUID(), role: 'system',
      content: `▶ Pipeline started — ${plan.tasks.length} task${plan.tasks.length !== 1 ? 's' : ''} dispatched`,
    }]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildTasks, activeSpaceId, workspaceId, groupSessions, settings, addPlan, llmProviders]);

  const handleClearBuild = useCallback(() => {
    setBuildTasks([]);
    setBuildTitle('');
    setBuildSessionId('');
  }, []);

  // ── Send message ──────────────────────────────────────────────────────────

  const handleSend = useCallback((overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || streaming || generatingPlan) return;
    if (inputMode !== 'chat') return; // pipeline mode uses handleRunBuildPlan instead

    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    // ── Intent Classification & Autonomous Routing ──────────────────────────
    setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'user', content: text }]);
    setGeneratingPlan(true); // Show thinking state while classifying

    const { system: intentSystem, userContent: intentContent } = buildIntentClassifyPrompt(text);
    llmProviders.planGen.complete([{ role: 'user', content: intentContent }], intentSystem).then(res => {
      const intent = res.toLowerCase().trim().includes('plan') ? 'plan' : 'chat';
      if (intent === 'plan') {
        // Plan generation mode
        const { system: planSystem, userContent: planContent } = buildPlanGenPrompt(
          text, groupSessions.map(s => ({ title: s.title })),
        );
        llmProviders.planGen.complete([{ role: 'user', content: planContent }], planSystem).then(planRes => {
          const { goal: extractedGoal, tasks: rawTasks } = parsePlanGenResponse(planRes, text);
          const idMap = new Map<string, string>();
          rawTasks.forEach(t => idMap.set(t.title, crypto.randomUUID()));

          const tasks: OrchestratorTask[] = rawTasks.map((t: RawPlanTask) => {
            const session = groupSessions.find(s =>
              s.title.toLowerCase() === t.assignedSessionTitle.toLowerCase()
            ) ?? groupSessions[0];
            return {
              id:                   idMap.get(t.title)!,
              title:                t.title,
              description:          t.description,
              assignedSessionId:    session?.id    ?? '',
              assignedSessionTitle: session?.title ?? t.assignedSessionTitle,
              dependsOn:            t.dependsOn
                .map(depTitle => idMap.get(depTitle) ?? '')
                .filter(Boolean),
              status: 'pending' as const,
            };
          });

          setPendingPlan({ goal: extractedGoal, tasks });
        }).catch((err: Error) => {
          setMessages(prev => [...prev, {
            id: crypto.randomUUID(), role: 'system',
            content: `⚠ Plan generation failed: ${err.message}`,
          }]);
        }).finally(() => setGeneratingPlan(false));
      } else {
        // Chat mode
        setGeneratingPlan(false);
        streamingContentRef.current = '';

        const assistantId                  = crypto.randomUUID();
        const assistantMsg: DisplayMessage = { id: assistantId, role: 'assistant', content: '', streaming: true };

        setMessages(prev => [...prev, assistantMsg]);
        const newHistory: ChatMessage[] = [...apiHistory, { role: 'user', content: text }];
        setApiHistory(newHistory);
        setStreaming(true);
        setOllamaOnline(true); // optimistic

        const systemPrompt = buildSystemPrompt(
          workspace?.name ?? workspaceId,
          activeSpace?.name ?? null,
          groupSessions.map(s => s.title),
        );

        const cancel = llmProviders.chat.stream(
          newHistory,
          systemPrompt,
          {
            onToken: (token) => {
              streamingContentRef.current += token;
              setMessages(prev =>
                prev.map(m => m.id === assistantId ? { ...m, content: m.content + token } : m),
              );
            },
            onDone: () => {
              const finalContent = streamingContentRef.current;
              setStreaming(false);
              setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, streaming: false } : m));
              setApiHistory(h => [...h, { role: 'assistant', content: finalContent }]);
              cancelRef.current = null;
              scrollToBottom();

              const inj = parseInject(finalContent, groupSessions);
              if (inj) {
                writePtyChunked(inj.sessionId, inj.message + '\r').catch(() => {});
                setMessages(prev => [...prev, {
                  id: crypto.randomUUID(),
                  role: 'system',
                  content: `✦ Sent to ${inj.sessionTitle}: ${inj.message}`,
                  injectedSessionTitle: inj.sessionTitle,
                  sessionColor: inj.sessionColor,
                }]);
              }
            },
            onError: (err) => {
              setStreaming(false);
              setOllamaOnline(false);
              setMessages(prev =>
                prev.map(m => m.id === assistantId ? { ...m, content: `Error: ${err}`, streaming: false } : m),
              );
              cancelRef.current = null;
            },
          }
        );

        cancelRef.current = cancel;
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, streaming, generatingPlan, inputMode, settings, workspace, activeSpace, groupSessions, apiHistory, workspaceId, llmProviders]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  };

  const handleStop = () => {
    cancelRef.current?.();
    cancelRef.current = null;
    setStreaming(false);
    setMessages(prev => prev.map(m => m.streaming ? { ...m, streaming: false } : m));
  };

  // ── Save to Prompt Vault ──────────────────────────────────────────────────

  const handleSaveToVault = useCallback((msg: DisplayMessage) => {
    const title = msg.content.slice(0, 60) + (msg.content.length > 60 ? '…' : '');
    addSavedPrompt({
      workspaceId,
      spaceId: activeSpaceId ?? null,
      title,
      content: msg.content,
      tags: [],
    });
    showToast('Saved to Prompt Vault', 'success');
  }, [workspaceId, activeSpaceId, addSavedPrompt, showToast]);

  // ── Export transcript ─────────────────────────────────────────────────────

  const handleExport = () => {
    const today = new Date().toISOString().slice(0, 10);
    const lines = messages.map(m => {
      if (m.role === 'user')          return `**You** (${today}):\n${m.content}\n`;
      if (m.role === 'assistant')     return `**Ollama** (${today}):\n${m.content}\n`;
      if (m.role === 'agent-summary') return `*[${m.sessionTitle}]:* ${m.content}\n`;
      if (m.role === 'system')        return `*${m.content}*\n`;
      return '';
    }).filter(Boolean);
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `orchaterm-chat-${today}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Clear history ─────────────────────────────────────────────────────────

  const handleClear = () => {
    localStorage.removeItem(storageKeyRef.current);
    setMessages([]);
    setApiHistory([]);
  };

  // ── Guards ────────────────────────────────────────────────────────────────

  const modelMissing = !settings.llmProviders?.chat?.model;

  // ── Render ────────────────────────────────────────────────────────────────

  // Workspace info overlay — shows WorkspacePanel when user clicks ℹ
  if (showWorkspaceInfo && workspace) {
    return (
      <div className={s.root}>
        <div className={s.infoPanelHeader}>
          <span className={s.infoPanelTitle}>Workspace Info</span>
          <button className={s.infoPanelClose} onClick={() => setShowWorkspaceInfo(false)} title="Back to chat">
            <XIcon size={12} />
          </button>
        </div>
        <WorkspacePanel workspace={workspace} />
      </div>
    );
  }

  return (
    <div className={s.root}>

      {/* Header */}
      <div className={s.header}>
        <div className={s.headerLeft}>
          <Bot size={14} className={s.botIcon} />
          <span className={s.headerTitle}>
            {activeSpace ? activeSpace.name : 'Workspace'} Chat
          </span>
          {activeSpace && (
            <span
              className={s.groupBadge}
              style={{
                backgroundColor: activeSpace.color + '22',
                color: activeSpace.color,
                borderColor: activeSpace.color + '44',
              }}
              title={groupSessions.map(s => s.title).join(', ') || 'No sessions assigned'}
            >
              <Users size={9} />
              {groupSessions.length} session{groupSessions.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        <div className={s.headerRight}>
          {/* Export */}
          {messages.length > 0 && (
            <button className={s.headerIconBtn} onClick={handleExport} title="Export transcript (.md)">
              <Download size={12} />
            </button>
          )}
          {/* Clear */}
          {messages.length > 0 && (
            <button className={s.headerIconBtn} onClick={handleClear} title="Clear chat history">
              <XIcon size={12} />
            </button>
          )}
          {/* Ollama status */}
          {ollamaOnline === false && (
            <span className={s.offlineBadge}><WifiOff size={10} /> Offline</span>
          )}
          {ollamaOnline === true && (
            <span className={s.onlineBadge}>
              <span className={s.onlineDot} /> Ollama
            </span>
          )}
          <button
            className={s.refreshBtn}
            onClick={checkOnline}
            disabled={checking}
            title="Check Ollama connection"
          >
            <RefreshCw size={11} className={cx(checking && s.spin)} />
          </button>
          {/* Workspace info */}
          {workspace && (
            <button
              className={s.headerIconBtn}
              onClick={() => setShowWorkspaceInfo(true)}
              title="Workspace info"
            >
              <Info size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Warning banners */}
      {modelMissing && (
        <div className={s.warningBanner}>
          ⚠ No chat model configured — go to <strong>Settings → LLM Providers</strong> to configure one.
        </div>
      )}
      {ollamaOnline === false && !modelMissing && (
        <div className={s.warningBanner}>
          ⚠ Chat provider is offline. Check your LLM provider settings.
        </div>
      )}
      {/* Stale space sessions */}
      {activeSpace && activeSpace.sessionIds.length > 0 && groupSessions.length === 0 && (
        <div className={s.warningBanner}>
          ⚠ Sessions assigned to <strong>{activeSpace.name}</strong> are from a previous launch.{' '}
          <button
            className={s.inlineLinkBtn}
            onClick={() => {
              localStorage.setItem('orchaterm:open-space-modal', activeSpace.id);
              window.dispatchEvent(new Event('orchaterm:open-space-modal'));
            }}
          >
            Re-add sessions
          </button>{' '}via Space settings.
        </div>
      )}

      {/* Message list */}
      <div className={s.messageList} onScroll={handleScroll}>
        {messages.length === 0 ? (
          <div className={s.emptyState}>
            <Bot size={28} className={s.emptyIcon} />
            <p className={s.emptyTitle}>
              {activeSpace ? `Orchestrating "${activeSpace.name}"` : 'Workspace AI'}
            </p>
            {inputMode === 'pipeline' ? (
              <p className={s.emptyHint}>
                Add tasks below, assign agents, then hit Run Pipeline.
              </p>
            ) : (
              <>
                <p className={s.emptyHint}>
                  Ask anything about your terminals, tasks, or workflow.
                </p>
                <div className={s.suggestions}>
                  {getSuggestions(groupSessions.map(s => s.title)).map(suggestion => (
                    <button
                      key={suggestion}
                      className={s.suggestionBtn}
                      onClick={() => handleSend(suggestion)}
                      disabled={modelMissing || ollamaOnline === false}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          messages.map(msg => (
            <MessageRow
              key={msg.id}
              msg={msg}
              onSaveToVault={() => handleSaveToVault(msg)}
            />
          ))
        )}
        {/* Plan generating indicator */}
        {generatingPlan && (
          <div className={s.planThinking}>
            <span className={s.planThinkingDot} />
            <span className={s.planThinkingDot} style={{ animationDelay: '0.2s' }} />
            <span className={s.planThinkingDot} style={{ animationDelay: '0.4s' }} />
            <span className={s.planThinkingLabel}>Generating plan…</span>
          </div>
        )}

        {/* Pending plan preview — confirm before running */}
        {pendingPlan && !generatingPlan && (
          <div className={s.planPreview}>
            <div className={s.planPreviewHeader}>
              <SlidersHorizontal size={12} />
              <span>Proposed Pipeline</span>
            </div>
            <div className={s.planTaskList}>
              {pendingPlan.tasks.map((task, i) => {
                const depNames = task.dependsOn
                  .map(id => pendingPlan.tasks.find(t => t.id === id)?.title ?? '?')
                  .filter(Boolean);
                return (
                  <div key={task.id} className={s.planTask}>
                    <span className={s.planTaskNum}>{i + 1}</span>
                    <div className={s.planTaskBody}>
                      <div className={s.planTaskTitle}>{task.title}</div>
                      <div className={s.planTaskMeta}>
                        <span className={s.planTaskAgent}>{task.assignedSessionTitle}</span>
                        {depNames.length > 0 && (
                          <span className={s.planTaskDeps}>after: {depNames.join(', ')}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className={s.planPreviewActions}>
              <button
                className={s.planRunBtn}
                onClick={handleRunPlan}
                title="Start running this plan"
              >
                ▶ Run Plan
              </button>
              <button className={s.planDiscardBtn} onClick={handleDiscardPlan}>✕ Discard</button>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {showScrollBtn && (
        <button className={s.scrollBtn} onClick={() => scrollToBottom()}>
          <ChevronDown size={14} />
        </button>
      )}

      {/* Input mode bar — separates feed from command area */}
      <div className={s.inputModeBar}>
        <div className={s.inputModePill}>
          <button
            className={cx(s.inputModeBtn, inputMode === 'chat' && s.inputModeBtnActive)}
            onClick={() => setInputMode('chat')}
            title="Chat with AI or generate plans in natural language"
          >
            <MessageSquare size={10} />
            Chat
          </button>
          <button
            className={cx(s.inputModeBtn, inputMode === 'pipeline' && s.inputModeBtnActive)}
            onClick={() => setInputMode('pipeline')}
            title="Manually build and run a task pipeline"
          >
            <Network size={10} />
            Pipeline
          </button>
        </div>

        {/* Features — only relevant in chat mode */}
        {!modelMissing && inputMode === 'chat' && (
          <div ref={featuresRef} style={{ position: 'relative' }}>
            <button
              className={cx(s.inputModeIconBtn, featuresOpen && s.inputModeIconBtnActive)}
              onClick={() => setFeaturesOpen(p => !p)}
              title="Chat features"
            >
              <SlidersHorizontal size={11} />
            </button>

            {featuresOpen && (
              <div className={cx(s.featuresPopover, s.featuresPopoverUp)}>
                {/* Background features */}
                <div className={s.featureSection}>
                  <span className={s.featureSectionLabel}>Background</span>
                  <button
                    className={cx(s.featureOption, liveFeedOn && s.featureOptionActiveGreen)}
                    onClick={toggleLiveFeed}
                  >
                    <span className={s.featureOptionCheck}>{liveFeedOn && <Check size={9} />}</span>
                    <span className={s.featureOptionContent}>
                      <span className={s.featureOptionTitle}>Live feed</span>
                      <span className={s.featureOptionDesc}>Stream agent summaries into chat</span>
                    </span>
                  </button>
                  <button
                    className={cx(s.featureOption, autoModeOn && s.featureOptionActiveYellow)}
                    onClick={toggleAutoMode}
                  >
                    <span className={s.featureOptionCheck}>{autoModeOn && <Check size={9} />}</span>
                    <span className={s.featureOptionContent}>
                      <span className={s.featureOptionTitle}>Auto-route</span>
                      <span className={s.featureOptionDesc}>Relay context between agents automatically</span>
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Live pipeline board — always visible when a plan is running ── */}
      {livePlan && livePlan.tasks.length > 0 && (
        <div className={css`
          border-top: 1px solid var(--border-color);
          padding: 8px 12px;
          background: var(--bg-secondary);
          display: flex; flex-direction: column; gap: 3px;
        `}>
          <div className={css`
            font-size:10px;font-weight:700;letter-spacing:.08em;
            color:var(--text-secondary);text-transform:uppercase;margin-bottom:4px;
            display:flex;align-items:center;gap:6px;
          `}>
            <span style={{color:
              livePlan.status==='running' ? '#7b68ee' :
              livePlan.status==='done'    ? '#3fb950' :
              livePlan.status==='failed'  ? '#f85149' : '#e3b341'
            }}>
              {livePlan.status==='running' ? '⚡' :
               livePlan.status==='done'    ? '✓'  :
               livePlan.status==='failed'  ? '✗'  : '⏸'}
            </span>
            <span className={css`flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`}>
              {livePlan.goal}
            </span>
            {livePlan.status === 'running' && (
              <button
                title="Pause orchestration"
                onClick={() => orchestratorEngine.pause()}
                className={css`background:none;border:1px solid var(--border-color);color:var(--text-secondary);
                  border-radius:3px;padding:1px 6px;font-size:10px;cursor:pointer;
                  &:hover{color:var(--text-primary);border-color:var(--text-secondary);}`}
              >⏸</button>
            )}
            {livePlan.status === 'paused' && (
              <button
                title="Resume orchestration"
                onClick={() => orchestratorEngine.resume()}
                className={css`background:none;border:1px solid #7b68ee;color:#7b68ee;
                  border-radius:3px;padding:1px 6px;font-size:10px;cursor:pointer;
                  &:hover{background:#7b68ee20;}`}
              >▶</button>
            )}
            {(livePlan.status === 'running' || livePlan.status === 'paused') && (
              <button
                title="Stop orchestration"
                onClick={() => orchestratorEngine.stop()}
                className={css`background:none;border:1px solid #f85149;color:#f85149;
                  border-radius:3px;padding:1px 6px;font-size:10px;cursor:pointer;
                  &:hover{background:#f8514920;}`}
              >■</button>
            )}
            {(livePlan.status === 'done' || livePlan.status === 'failed') && (
              <button
                title="Dismiss"
                onClick={() => setLivePlan(null)}
                className={css`background:none;border:none;color:var(--text-secondary);
                  padding:1px 4px;font-size:12px;cursor:pointer;line-height:1;
                  &:hover{color:var(--text-primary);}`}
              >×</button>
            )}
          </div>
          {livePlan.tasks.map(task => {
            const statusColor =
              task.status==='running' ? '#7b68ee' :
              task.status==='done'    ? '#3fb950' :
              task.status==='failed'  ? '#f85149' : '#6e7681';
            const statusIcon =
              task.status==='running' ? '▶' :
              task.status==='done'    ? '✓' :
              task.status==='failed'  ? '✗' : '○';
            const elapsed = task.startedAt
              ? task.completedAt
                ? ((task.completedAt - task.startedAt) / 1000).toFixed(1) + 's'
                : Math.round((Date.now() - task.startedAt) / 1000) + 's…'
              : null;
            return (
              <div key={task.id} className={css`
                display:flex;align-items:center;gap:6px;font-size:11px;
                padding:3px 6px;border-radius:3px;
                border-left:2px solid ${statusColor};
                background:var(--bg-primary);
              `}>
                <span style={{color:statusColor,fontWeight:700,width:10,flexShrink:0}}>{statusIcon}</span>
                <span className={css`flex:1;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`}>{task.title}</span>
                <span className={css`color:var(--text-secondary);font-size:10px;flex-shrink:0;`}>{task.assignedSessionTitle}</span>
                {elapsed && <span className={css`color:var(--text-secondary);font-size:10px;min-width:32px;text-align:right;flex-shrink:0;`}>{elapsed}</span>}
                {task.status==='done' && (task.output?.filesModified?.length ?? 0) > 0 && (
                  <span title={task.output!.filesModified.join(', ')} className={css`color:#3fb950;font-size:10px;flex-shrink:0;cursor:default;`}>
                    📄{task.output!.filesModified.length}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Chat input area */}
      {inputMode === 'chat' && (
        <div className={s.inputArea}>
          <textarea
            ref={textareaRef}
            className={s.textarea}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={
              modelMissing
                ? 'Configure an Ollama model in Settings first…'
                : generatingPlan
                ? 'Generating plan…'
                : streaming
                ? 'Ollama is responding…'
                : ollamaOnline === false
                ? 'Ollama offline — start it to chat'
                : 'Ask anything or describe a goal — ↵ send, Shift+↵ newline'
            }
            disabled={modelMissing || ollamaOnline === false || generatingPlan}
            rows={1}
          />
          {streaming ? (
            <button className={cx(s.sendBtn, s.stopBtn)} onClick={handleStop} title="Stop">■</button>
          ) : (
            <button
              className={s.sendBtn}
              onClick={() => handleSend()}
              disabled={!input.trim() || modelMissing || ollamaOnline === false || generatingPlan}
              title="Send (Enter)"
            >
              <Send size={13} />
            </button>
          )}
        </div>
      )}

      {/* Pipeline builder area */}
      {inputMode === 'pipeline' && (
        <div className={s.pipelineArea}>
          {/* Task list */}
          {buildTasks.length > 0 && (
            <div className={s.pipelineTaskList}>
              {buildTasks.map((task, i) => (
                <div key={task.id} className={s.pipelineTaskItem}>
                  <span className={s.pipelineTaskNum}>{i + 1}</span>
                  <span className={s.pipelineTaskTitle}>{task.title}</span>
                  <span className={s.pipelineTaskAgent}>{task.assignedSessionTitle}</span>
                  <button
                    className={s.pipelineTaskRemove}
                    onClick={() => handleRemoveBuildTask(task.id)}
                    title="Remove task"
                  >
                    <XIcon size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {buildTasks.length === 0 && (
            <p className={s.pipelineEmpty}>No tasks yet — add tasks below then click Run</p>
          )}

          {/* Add task */}
          <div className={s.pipelineAddRow}>
            <input
              className={s.pipelineTitleInput}
              placeholder="Task description…"
              value={buildTitle}
              onChange={e => setBuildTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddBuildTask()}
            />
            <div className={s.pipelineAgentWrap}>
              <Select
                compact
                value={buildSessionId}
                onChange={setBuildSessionId}
                options={[
                  { value: '', name: 'Agent…' },
                  ...groupSessions.map(sess => ({ value: sess.id, name: sess.title })),
                ]}
              />
            </div>
            <button
              className={s.pipelineAddBtn}
              onClick={handleAddBuildTask}
              disabled={!buildTitle.trim() || !buildSessionId}
              title="Add task (Enter)"
            >
              +
            </button>
          </div>

          {/* Run / Clear */}
          <div className={s.pipelineActions}>
            <button
              className={s.pipelineRunBtn}
              onClick={handleRunBuildPlan}
              disabled={buildTasks.length === 0}
              title={`Run ${buildTasks.length} task${buildTasks.length !== 1 ? 's' : ''}`}
            >
              ▶ Run Pipeline
            </button>
            {buildTasks.length > 0 && (
              <button className={s.pipelineClearBtn} onClick={handleClearBuild}>Clear</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ── MessageRow ─────────────────────────────────────────────────────────────────

const MessageRow: React.FC<{
  msg: DisplayMessage;
  onSaveToVault: () => void;
}> = ({ msg, onSaveToVault }) => {
  const [hovered, setHovered] = useState(false);

  if (msg.role === 'conductor') {
    const icons: Record<string, string> = {
      dispatch: '→', sentinel: '✓', relay: '⚡',
      error: '✗', timeout: '⏱', info: 'ℹ', 'user-override': '⚙',
    };
    const colors: Record<string, string> = {
      dispatch: '#7b68ee', sentinel: '#3fb950', relay: '#a371f7',
      error: '#f85149', timeout: '#e3b341', info: '#6e7681', 'user-override': '#e3b341',
    };
    const type = msg.conductorType ?? 'info';

    // Sentinel with full task output → rich agent report card
    if (type === 'sentinel' && msg.taskOutput) {
      const out = msg.taskOutput;
      const cardStyle = css`
        margin: 4px 0;
        padding: 10px 12px;
        border-radius: var(--border-radius-sm);
        border: 1px solid #3fb95033;
        background: #3fb9500d;
        font-size: 12px;
        line-height: 1.5;
      `;
      const headerStyle = css`
        display: flex; align-items: center; gap: 6px;
        font-weight: 600; color: #3fb950; margin-bottom: 6px;
      `;
      const labelStyle = css`color: var(--text-secondary); font-size: 11px; font-weight: 600; margin-top: 4px;`;
      const valueStyle = css`color: var(--text-primary);`;
      return (
        <div className={cardStyle}>
          <div className={headerStyle}>
            <span>✓</span>
            <span>{msg.agentTitle ?? 'Agent'} completed: {msg.content.replace('Task "', '').replace('" complete', '')}</span>
          </div>
          <div className={labelStyle}>SUMMARY</div>
          <div className={valueStyle}>{out.summary}</div>
          {out.filesModified.length > 0 && (
            <>
              <div className={labelStyle}>FILES MODIFIED</div>
              <div className={valueStyle}>{out.filesModified.join(', ')}</div>
            </>
          )}
          {out.needs && out.needs !== 'none' && (
            <>
              <div className={labelStyle}>HANDOFF TO NEXT AGENT</div>
              <div className={valueStyle}>{out.needs}</div>
            </>
          )}
        </div>
      );
    }

    return (
      <div className={s.conductorRow}>
        <span className={s.conductorIcon} style={{ color: colors[type] ?? '#6e7681' }}>
          {icons[type] ?? '·'}
        </span>
        <span className={s.conductorText}>{msg.content}</span>
      </div>
    );
  }

  if (msg.role === 'agent-summary') {
    return (
      <div className={s.agentSummaryRow}>
        <span className={s.agentSummaryDot} style={{ backgroundColor: msg.sessionColor ?? '#475569' }} />
        <span className={s.agentSummaryTitle}>{msg.sessionTitle}</span>
        <span className={s.agentSummaryText}>{msg.content}</span>
      </div>
    );
  }

  if (msg.role === 'system') {
    return (
      <div
        className={s.systemRow}
        style={msg.sessionColor
          ? { borderLeftColor: msg.sessionColor, backgroundColor: msg.sessionColor + '0d' }
          : undefined}
      >
        {msg.content}
      </div>
    );
  }

  return (
    <div
      className={cx(s.msgRow, msg.role === 'user' ? s.msgRowUser : s.msgRowAssistant)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {msg.role === 'assistant' && <div className={s.avatar}><Bot size={12} /></div>}
      <div className={cx(s.bubble, msg.role === 'user' ? s.bubbleUser : s.bubbleAssistant)}>
        <div className={s.msgText}>{renderMarkdown(msg.content)}</div>
        {msg.streaming && <span className={s.cursor} />}
        {msg.role === 'assistant' && !msg.streaming && hovered && (
          <button className={s.vaultBtn} onClick={onSaveToVault} title="Save to Prompt Vault">
            <BookmarkPlus size={11} />
          </button>
        )}
      </div>
      {msg.role === 'user' && <div className={cx(s.avatar, s.avatarUser)}><User size={12} /></div>}
    </div>
  );
};

// ── Styles ─────────────────────────────────────────────────────────────────────

const s = {
  root: css`
    display: flex; flex-direction: column;
    flex: 1; min-height: 0; height: 100%;
    background: #010409; overflow: hidden; position: relative;
  `,

  /* ── Workspace info overlay ── */
  infoPanelHeader: css`
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid rgba(255,255,255,0.07);
    background: #0d1117;
    flex-shrink: 0;
  `,
  infoPanelTitle: css`
    font-size: 12px; font-weight: 700; color: #f0f6fc;
  `,
  infoPanelClose: css`
    display: flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; border-radius: 6px;
    background: transparent; border: none;
    color: #7d8590; cursor: pointer;
    transition: background 0.15s, color 0.15s;
    &:hover { background: rgba(255,255,255,0.07); color: #f0f6fc; }
  `,

  /* ── Input mode bar ── */
  inputModeBar: css`
    display: flex; align-items: center; justify-content: space-between;
    padding: 5px 10px 5px 12px;
    border-top: 1px solid rgba(255,255,255,0.07);
    border-bottom: 1px solid rgba(255,255,255,0.07);
    background: #0d1117;
    flex-shrink: 0;
  `,
  inputModePill: css`
    display: flex; gap: 2px;
    background: #010409;
    border-radius: 99px;
    padding: 3px;
    border: 1px solid rgba(255,255,255,0.07);
  `,
  inputModeBtn: css`
    display: flex; align-items: center; gap: 4px;
    padding: 4px 12px;
    border-radius: 99px;
    font-size: 11px; font-weight: 600;
    color: #7d8590;
    background: transparent;
    border: none; cursor: pointer;
    transition: color 0.15s, background 0.15s;
    white-space: nowrap;
    &:hover { color: #adbac7; }
  `,
  inputModeBtnActive: css`
    background: var(--color-brand) !important;
    color: #fff !important;
    box-shadow: 0 2px 6px rgba(var(--color-brand-rgb), 0.3);
  `,
  inputModeIconBtn: css`
    display: flex; align-items: center; justify-content: center;
    width: 26px; height: 26px;
    border-radius: 7px;
    color: #7d8590;
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    transition: all 0.15s;
    &:hover { color: #adbac7; border-color: rgba(255,255,255,0.1); }
  `,
  inputModeIconBtnActive: css`
    color: var(--color-brand) !important;
    background: rgba(var(--color-brand-rgb), 0.12) !important;
    border-color: rgba(var(--color-brand-rgb), 0.3) !important;
  `,
  /* Makes featuresPopover open upward when triggered from bottom bar */
  featuresPopoverUp: css`
    top: auto !important;
    bottom: calc(100% + 6px) !important;
  `,

  /* ── Pipeline builder area ── */
  pipelineArea: css`
    flex-shrink: 0;
    border-top: 1px solid rgba(255,255,255,0.07);
    padding: 8px 10px;
    display: flex; flex-direction: column; gap: 6px;
    background: #0d1117;
  `,
  pipelineTaskList: css`
    display: flex; flex-direction: column; gap: 3px;
    max-height: 100px; overflow-y: auto;
  `,
  pipelineTaskItem: css`
    display: flex; align-items: center; gap: 6px;
    padding: 4px 8px;
    border-radius: 6px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.07);
  `,
  pipelineTaskNum: css`
    font-size: 10px; color: #7d8590; font-weight: 700;
    flex-shrink: 0; width: 14px; text-align: right;
  `,
  pipelineTaskTitle: css`
    flex: 1; font-size: 11px; color: #f0f6fc;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  `,
  pipelineTaskAgent: css`
    font-size: 10px; color: var(--color-brand); font-weight: 600;
    flex-shrink: 0; max-width: 80px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  `,
  pipelineTaskRemove: css`
    display: flex; align-items: center; justify-content: center;
    width: 16px; height: 16px; border-radius: 3px;
    background: transparent; border: none;
    color: #7d8590; cursor: pointer; flex-shrink: 0;
    transition: color 0.12s, background 0.12s;
    &:hover { color: #f85149; background: rgba(248,81,73,0.12); }
  `,
  pipelineEmpty: css`
    font-size: 11px; color: #7d8590;
    text-align: center; padding: 4px 0; font-style: italic;
  `,
  pipelineAddRow: css`
    display: flex; align-items: center; gap: 5px;
  `,
  pipelineAgentWrap: css`
    width: 130px; flex-shrink: 0;
  `,
  pipelineTitleInput: css`
    flex: 1; min-width: 0;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 6px;
    padding: 5px 8px;
    font-size: 11px; color: #f0f6fc;
    outline: none; font-family: var(--font-family);
    transition: border-color 0.15s;
    &:focus { border-color: var(--color-brand); }
    &::placeholder { color: #7d8590; }
  `,
  pipelineAddBtn: css`
    width: 28px; height: 28px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    border-radius: 6px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    color: #adbac7; font-size: 16px; font-weight: 400;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
    &:hover { background: var(--color-brand); border-color: var(--color-brand); color: #fff; }
    &:disabled { opacity: 0.35; cursor: default; }
  `,
  pipelineActions: css`
    display: flex; align-items: center; gap: 7px;
  `,
  pipelineRunBtn: css`
    flex: 1;
    background: var(--gradient-brand);
    color: #fff; border: none; border-radius: 7px;
    padding: 6px 10px;
    font-size: 11px; font-weight: 700;
    cursor: pointer;
    transition: filter 0.15s;
    &:hover { filter: brightness(1.08); }
    &:disabled { opacity: 0.4; cursor: default; filter: none; }
  `,
  pipelineClearBtn: css`
    background: transparent;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 7px;
    padding: 6px 10px;
    font-size: 11px; font-weight: 600;
    color: #7d8590; cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
    &:hover { border-color: rgba(255,255,255,0.2); color: #adbac7; }
  `,
  header: css`
    display: flex; align-items: center; justify-content: space-between;
    padding: 9px 12px; border-bottom: 1px solid rgba(255,255,255,0.07);
    background: #0d1117; flex-shrink: 0; gap: 8px;
  `,
  headerLeft: css`display: flex; align-items: center; gap: 7px; min-width: 0; flex: 1; overflow: hidden;`,
  headerRight: css`display: flex; align-items: center; gap: 4px; flex-shrink: 0;`,
  botIcon: css`color: var(--color-brand); flex-shrink: 0;`,
  headerTitle: css`font-size: 12px; font-weight: 700; color: #f0f6fc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`,
  groupBadge: css`
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 10px; font-weight: 600; padding: 1px 6px;
    border-radius: 99px; border: 1px solid; flex-shrink: 0; cursor: default;
    opacity: 0.85;
  `,
  headerIconBtn: css`
    width: 24px; height: 24px; border-radius: 5px; border: none;
    background: transparent; color: #6e7681; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 150ms ease;
    &:hover { background: rgba(255,255,255,0.07); color: #c9d1d9; }
  `,
  headerIconBtnActive: css`
    color: #3fb950 !important;
    background: rgba(63,185,80,0.1) !important;
  `,
  headerIconBtnAutoMode: css`
    color: #e3b341 !important;
    background: rgba(227,179,65,0.1) !important;
  `,
  onlineBadge: css`display: flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 600; color: #3fb950;`,
  onlineDot: css`
    width: 5px; height: 5px; border-radius: 50%; background: #3fb950;
    animation: blink 2.5s ease-in-out infinite;
    @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
  `,
  offlineBadge: css`display: flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 600; color: #f85149;`,
  refreshBtn: css`
    width: 22px; height: 22px; border-radius: 5px; border: none;
    background: transparent; color: #6e7681; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 150ms ease;
    &:hover { background: rgba(255,255,255,0.07); color: #c9d1d9; }
    &:disabled { opacity: 0.4; cursor: default; }
  `,
  spin: css`animation: spin 0.8s linear infinite; @keyframes spin { to { transform: rotate(360deg); } }`,
  warningBanner: css`
    background: rgba(245,158,11,0.07); border-bottom: 1px solid rgba(245,158,11,0.15);
    padding: 8px 14px; font-size: 11px; color: #e3b341; flex-shrink: 0; line-height: 1.5;
    code { font-family: 'Fira Code',monospace; color: #e3b341; }
    strong { color: #e3b341; }
  `,
  inlineLinkBtn: css`
    background: transparent; border: none; color: #e3b341;
    text-decoration: underline; cursor: pointer; font-size: inherit; padding: 0;
    &:hover { color: #f0f6fc; }
  `,
  messageList: css`
    flex: 1; overflow-y: auto; padding: 14px 12px;
    display: flex; flex-direction: column; gap: 10px;
    scroll-behavior: smooth;
    &::-webkit-scrollbar { width: 4px; }
    &::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
  `,
  emptyState: css`
    flex: 1; display: flex; flex-direction: column; align-items: center;
    justify-content: center; text-align: center; padding: 40px 24px;
    gap: 8px; margin: auto 0;
  `,
  emptyIcon: css`color: #1e3a5f; margin-bottom: 4px;`,
  emptyTitle: css`font-size: 13px; font-weight: 700; color: #64748b; margin: 0;`,
  emptyHint: css`font-size: 11px; color: #475569; line-height: 1.5; margin: 0; max-width: 260px;`,
  suggestions: css`
    display: flex; flex-direction: column; gap: 6px; margin-top: 12px; width: 100%; max-width: 280px;
  `,
  suggestionBtn: css`
    background: #0b1520; border: 1px solid #1e3a5f; border-radius: 8px;
    color: #64748b; font-size: 11px; padding: 8px 12px; cursor: pointer;
    text-align: left; transition: all 150ms ease; line-height: 1.4; width: 100%;
    &:hover:not(:disabled) { border-color: var(--color-brand); color: #e2e8f0; background: rgba(123, 104, 238, 0.08); }
    &:disabled { opacity: 0.4; cursor: not-allowed; }
  `,
  msgRow: css`display: flex; align-items: flex-end; gap: 8px; position: relative;`,
  msgRowUser: css`flex-direction: row-reverse;`,
  msgRowAssistant: css`flex-direction: row;`,
  avatar: css`
    width: 22px; height: 22px; border-radius: 50%;
    background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
    display: flex; align-items: center; justify-content: center;
    color: var(--color-brand); flex-shrink: 0;
  `,
  avatarUser: css`background: rgba(123, 104, 238, 0.10); border-color: rgba(123, 104, 238, 0.28);`,
  bubble: css`
    max-width: 82%; padding: 9px 12px; border-radius: 10px;
    font-size: 12px; line-height: 1.6; word-break: break-word; position: relative;
  `,
  bubbleUser: css`
    background: rgba(123, 104, 238, 0.12); border: 1px solid rgba(123, 104, 238, 0.22);
    border-bottom-right-radius: 3px; color: #c4b5fd;
  `,
  bubbleAssistant: css`
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
    border-bottom-left-radius: 3px; color: #c9d1d9;
  `,
  msgText: css`margin: 0; font-size: inherit; line-height: 1.6;`,
  cursor: css`
    display: inline-block; width: 6px; height: 12px; background: var(--color-brand);
    border-radius: 1px; margin-left: 2px; vertical-align: text-bottom;
    animation: blink2 0.8s step-end infinite;
    @keyframes blink2 { 0%,100%{opacity:1} 50%{opacity:0} }
  `,
  vaultBtn: css`
    position: absolute; top: -8px; right: -8px;
    width: 20px; height: 20px; border-radius: 50%;
    background: #0d1117; border: 1px solid rgba(255,255,255,0.12);
    color: #6e7681; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 150ms ease;
    &:hover { border-color: var(--color-brand); color: var(--color-brand); }
  `,
  agentSummaryRow: css`
    display: flex; align-items: baseline; gap: 6px;
    padding: 4px 8px; background: rgba(255,255,255,0.03);
    border-radius: 5px; border-left: 2px solid rgba(255,255,255,0.12);
  `,
  agentSummaryDot: css`width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; margin-top: 3px;`,
  agentSummaryTitle: css`font-size: 10px; font-weight: 600; color: #6e7681; white-space: nowrap; flex-shrink: 0;`,
  agentSummaryText: css`font-size: 11px; color: #8b949e; line-height: 1.4;`,
  systemRow: css`
    font-size: 11px; color: #8b949e; padding: 5px 10px;
    border-left: 2px solid rgba(255,255,255,0.12); border-radius: 3px;
    background: rgba(255,255,255,0.03); line-height: 1.4;
  `,
  scrollBtn: css`
    position: absolute; bottom: 70px; right: 14px;
    width: 26px; height: 26px; border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.12); background: #0d1117; color: #6e7681;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    box-shadow: 0 4px 12px rgba(0,0,0,0.5); transition: all 150ms ease;
    &:hover { border-color: rgba(255,255,255,0.2); color: #c9d1d9; }
  `,
  inputArea: css`
    display: flex; align-items: flex-end; gap: 8px;
    padding: 10px 12px; border-top: 1px solid rgba(255,255,255,0.07);
    background: #0d1117; flex-shrink: 0;
  `,
  textarea: css`
    flex: 1; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px; padding: 8px 12px; color: #f0f6fc;
    font-size: 12px; font-family: inherit; line-height: 1.5;
    resize: none; outline: none; max-height: 120px; min-height: 36px;
    transition: border-color 150ms ease;
    &:focus { border-color: rgba(123, 104, 238, 0.5); }
    &::placeholder { color: #6e7681; }
    &:disabled { opacity: 0.4; cursor: not-allowed; }
  `,
  sendBtn: css`
    width: 32px; height: 32px; flex-shrink: 0; border-radius: 7px; border: none;
    background: var(--color-brand); color: #fff; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px; font-weight: 700; transition: all 150ms ease;
    &:hover:not(:disabled) { filter: brightness(1.10); }
    &:disabled { opacity: 0.35; cursor: not-allowed; }
  `,
  stopBtn: css`background: #ef4444 !important; color: #fff !important; &:hover { background: #f87171 !important; }`,

  // ── Conductor event row ──────────────────────────────────────────────────
  conductorRow: css`
    display: flex; align-items: baseline; gap: 7px;
    padding: 3px 10px; border-radius: 4px;
    background: rgba(123,104,238,0.04);
    border-left: 2px solid rgba(123,104,238,0.2);
  `,
  conductorIcon: css`font-size: 11px; font-weight: 700; flex-shrink: 0; min-width: 12px; text-align: center;`,
  conductorText: css`font-size: 11px; color: #8b949e; line-height: 1.4;`,

  // ── Plan mode ────────────────────────────────────────────────────────────
  headerIconBtnPlanMode: css`
    color: #58a6ff !important;
    background: rgba(88,166,255,0.1) !important;
  `,
  planThinking: css`
    display: flex; align-items: center; gap: 5px;
    padding: 8px 12px; border-radius: 6px;
    background: rgba(88,166,255,0.06); border: 1px solid rgba(88,166,255,0.15);
  `,
  planThinkingDot: css`
    width: 5px; height: 5px; border-radius: 50%; background: #58a6ff;
    animation: planPulse 1.2s ease-in-out infinite;
    @keyframes planPulse { 0%,100%{opacity:0.2;transform:scale(0.8)} 50%{opacity:1;transform:scale(1)} }
  `,
  planThinkingLabel: css`font-size: 11px; color: #58a6ff; margin-left: 4px;`,
  planPreview: css`
    border: 1px solid rgba(88,166,255,0.2); border-radius: 8px; overflow: hidden;
    background: rgba(88,166,255,0.04);
  `,
  planPreviewHeader: css`
    display: flex; align-items: center; gap: 7px;
    padding: 9px 12px; background: rgba(88,166,255,0.07);
    border-bottom: 1px solid rgba(88,166,255,0.15);
    font-size: 11px; font-weight: 600; color: #58a6ff;
  `,
  planPreviewGoal: css`
    font-weight: 400; color: #8b949e; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0;
  `,
  planTaskList: css`display: flex; flex-direction: column; gap: 1px; padding: 6px 0;`,
  planTask: css`
    display: flex; align-items: flex-start; gap: 10px; padding: 7px 12px;
    &:hover { background: rgba(255,255,255,0.02); }
  `,
  planTaskNum: css`
    font-size: 10px; font-weight: 700; color: #6e7681;
    min-width: 16px; text-align: right; padding-top: 1px; flex-shrink: 0;
  `,
  planTaskBody: css`display: flex; flex-direction: column; gap: 2px; min-width: 0;`,
  planTaskTitle: css`font-size: 12px; color: #e2e8f0; font-weight: 500;`,
  planTaskMeta: css`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`,
  planTaskAgent: css`
    font-size: 10px; color: #7b68ee; font-weight: 600;
    background: rgba(123,104,238,0.1); padding: 1px 6px; border-radius: 99px;
  `,
  planTaskDeps: css`font-size: 10px; color: #6e7681;`,
  planPreviewActions: css`
    display: flex; gap: 8px; padding: 10px 12px;
    border-top: 1px solid rgba(88,166,255,0.12); background: rgba(0,0,0,0.15);
  `,
  planRunBtn: css`
    flex: 1; padding: 7px 12px; border-radius: 6px; border: none;
    background: #58a6ff; color: #0d1117; font-size: 12px; font-weight: 700;
    cursor: pointer; transition: all 150ms ease;
    &:hover:not(:disabled) { filter: brightness(1.1); }
    &:disabled { opacity: 0.4; cursor: not-allowed; }
  `,
  planDiscardBtn: css`
    padding: 7px 14px; border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.1);
    background: transparent; color: #6e7681; font-size: 12px;
    cursor: pointer; transition: all 150ms ease;
    &:hover { border-color: #f85149; color: #f85149; }
  `,

  // ── Mode badge (header) ──────────────────────────────────────────────────
  modeBadge: css`
    font-size: 10px; font-weight: 600; padding: 2px 8px;
    border-radius: 99px; background: rgba(88,166,255,0.12);
    color: #58a6ff; border: 1px solid rgba(88,166,255,0.25);
    white-space: nowrap;
  `,

  // ── Features popover ─────────────────────────────────────────────────────
  featuresPopover: css`
    position: absolute; top: calc(100% + 6px); right: 0;
    width: 240px; background: #161b22;
    border: 1px solid rgba(255,255,255,0.1); border-radius: 10px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    overflow: hidden; z-index: 50;
  `,
  featureSection: css`
    padding: 10px 0 6px;
    & + & { border-top: 1px solid rgba(255,255,255,0.06); }
  `,
  featureSectionLabel: css`
    display: block; font-size: 10px; font-weight: 600;
    color: #6e7681; text-transform: uppercase; letter-spacing: 0.06em;
    padding: 0 14px 6px;
  `,
  featureOption: css`
    display: flex; align-items: flex-start; gap: 10px;
    width: 100%; padding: 7px 14px; border: none;
    background: transparent; cursor: pointer; text-align: left;
    transition: background 120ms ease;
    &:hover { background: rgba(255,255,255,0.04); }
  `,
  featureOptionActive: css`background: rgba(123,104,238,0.08) !important;`,
  featureOptionActivePlan: css`background: rgba(88,166,255,0.08) !important;`,
  featureOptionActiveGreen: css`background: rgba(63,185,80,0.08) !important;`,
  featureOptionActiveYellow: css`background: rgba(227,179,65,0.08) !important;`,
  featureOptionCheck: css`
    width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0; margin-top: 1px;
    border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.04);
    display: flex; align-items: center; justify-content: center; color: #c9d1d9;
  `,
  featureOptionContent: css`display: flex; flex-direction: column; gap: 1px; min-width: 0;`,
  featureOptionTitle: css`font-size: 12px; font-weight: 500; color: #e2e8f0;`,
  featureOptionDesc: css`font-size: 10px; color: #6e7681; line-height: 1.4;`,
};
