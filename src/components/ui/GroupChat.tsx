/**
 * GroupChat.tsx
 *
 * Streaming chat panel scoped to the active Space.
 *
 * Pipeline / plan-generation features have moved to the dedicated Pipeline tab.
 * When the chat classifies the user's message as a plan request, it generates
 * the plan and hands the result off to the parent via `onPendingPlan(goal, tasks)`.
 * The parent (RightPanel) flips the right-pane to the Pipeline tab and shows
 * a pending-plan preview in the Builder.
 *
 * Features kept here:
 * - Streaming chat with the active LLM provider (stale-closure fix via streamingContentRef)
 * - Chat history persisted to localStorage per workspace/space
 * - Live terminal feed: watchForSummary → summariseChunk → agent-summary messages
 * - Terminal injection: parses "INJECT → <title>: <msg>" from Ollama, calls write_pty
 * - Save message to Prompt Vault
 * - Export transcript as .md
 * - Contextual empty state with suggested prompts
 * - Inline Markdown rendering (code fences, bold, inline code)
 * - Conductor engine log feed (subscribed via window events from RightPanel)
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { css, cx } from '@emotion/css';
import {
  Send, Bot, User, WifiOff, RefreshCw, Users,
  ChevronDown, BookmarkPlus, Download, X as XIcon, SlidersHorizontal, Check,
  Copy, Square, Sparkles,
} from 'lucide-react';
import { useDashboard } from '../../context/DashboardContext';
import { writePtyChunked } from '../../utils/ptyUtils';
import {
  buildPlanGenPrompt,
  buildSummarisePrompt,
  buildIntentClassifyPrompt,
  parsePlanGenResponse,
  RawPlanTask,
} from '../../services/orchestratorPrompts';
import type { ChatMessage } from '../../services/llm/types';
import { bufferWatcher } from '../../services/bufferWatcher';
import { stripAnsiCodes } from '../../services/sentinelParser';
import { needsBroker } from '../../services/needsBroker';
import { autonomousOrchestrator } from '../../services/autonomousOrchestrator';
import type { OrchestratorTask, ConductorLogEntry } from '../../types';

// ── Props ──────────────────────────────────────────────────────────────────────

interface GroupChatProps {
  workspaceId: string;
  /** Called when the chat generates a plan. The parent lifts it into the Pipeline tab. */
  onPendingPlan?: (goal: string, tasks: OrchestratorTask[]) => void;
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
    background: var(--bg-tertiary); border-radius: 6px; padding: 8px 10px;
    margin: 6px 0; font-family: var(--font-family-mono);
    font-size: 11px; overflow-x: auto; white-space: pre; color: var(--text-secondary);
  `,
  bold: css`color: var(--text-primary);`,
  inlineCode: css`
    background: var(--bg-tertiary); border-radius: 3px; padding: 1px 5px;
    font-family: var(--font-family-mono); font-size: 0.9em; color: var(--color-warning);
  `,
};

// ── System prompt ──────────────────────────────────────────────────────────────

function buildSystemPrompt(
  workspaceName: string,
  spaceName: string | null,
  sessionTitles: string[],
  sessionOutputs?: { title: string; content: string }[],
): string {
  const spaceLine = spaceName
    ? `Active Space: "${spaceName}"`
    : 'No space is currently selected.';
  const sessionsLine = sessionTitles.length > 0
    ? `Terminal sessions in this space:\n${sessionTitles.map(t => `  • ${t}`).join('\n')}`
    : 'No terminal sessions are currently assigned to this space.';

  // Include recent terminal output so the LLM can answer questions about what
  // agents printed without asking the user to paste it in manually.
  const outputsSection = sessionOutputs && sessionOutputs.length > 0
    ? `\n\nCurrent terminal output (most recent ~2 000 chars each, ANSI stripped):\n\n${
        sessionOutputs
          .map(s => `=== ${s.title} ===\n${s.content || '(no output yet)'}`)
          .join('\n\n')
      }`
    : '';

  return `You are an AI orchestration assistant embedded inside Orchaterm, a developer workspace management tool.

Workspace: "${workspaceName}"
${spaceLine}
${sessionsLine}${outputsSection}

Your job: help the developer plan, coordinate, and execute work across their terminal sessions. You have full visibility into each terminal's recent output above — use it to answer questions directly without asking the user to paste anything. Be concise, direct, and practical. Think like a senior engineer and tech lead — not a chatbot. Avoid filler, avoid markdown headers, keep answers short unless depth is needed.

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

export const GroupChat: React.FC<GroupChatProps> = ({ workspaceId, onPendingPlan }) => {
  const {
    workspaces, spaces, terminalSessions,
    activeSpaceId, settings, updateSettings, addSavedPrompt, showToast, llmProviders,
  } = useDashboard();

  /** Master AI switch — when off, every LLM-triggering feature is disabled. */
  const aiEnabled = settings.aiEnabled !== false;

  const getProviderLabel = () => {
    const effectiveChatCfg = settings.llmProviderMode === 'simple'
      ? settings.simpleLlmProvider
      : settings.llmProviders?.chat;
    const provider = effectiveChatCfg?.provider;
    if (provider === 'ollama') return 'Ollama';
    if (provider === 'openai-compatible') {
      const baseUrl = effectiveChatCfg?.baseUrl || '';
      if (baseUrl.includes('deepseek')) return 'DeepSeek';
      if (baseUrl.includes('together')) return 'Together.ai';
      if (baseUrl.includes('localhost:1234') || baseUrl.includes('lm-studio')) return 'LM Studio';
      return 'OpenAI-compat';
    }
    if (provider === 'anthropic') return 'Anthropic';
    if (provider === 'gemini') return 'Gemini';
    return 'LLM';
  };
  const providerLabel = getProviderLabel();

  const workspace     = workspaces.find(w => w.id === workspaceId);
  const activeSpace   = spaces.find(g => g.id === activeSpaceId);
  const allSessions   = terminalSessions.filter(s => s.workspaceId === workspaceId);
  const groupSessions = activeSpace
    ? allSessions.filter(s => activeSpace.sessionIds.includes(s.id))
    : allSessions;

  // ── Storage key — changes when space changes ──────────────────────────────
  const storageKey    = chatStorageKey(workspaceId, activeSpaceId ?? null);
  const storageKeyRef = useRef(storageKey);

  // ── Provider status ─────────────────────────────────────────────────────────
  const [providerOnline, setProviderOnline] = useState<boolean | null>(null);
  const [checking, setChecking]             = useState(false);

  const checkOnline = useCallback(async () => {
    setChecking(true);
    const ok = await llmProviders.chat.checkOnline();
    setProviderOnline(ok);
    setChecking(false);
  }, [llmProviders.chat]);

  useEffect(() => { checkOnline(); }, [checkOnline]);

  // ── Message history (persisted) ───────────────────────────────────────────
  const [messages,   setMessages]   = useState<DisplayMessage[]>(() => loadPersistedMessages(storageKey));
  const [apiHistory, setApiHistory] = useState<ChatMessage[]>([]);
  const [input,      setInput]      = useState('');
  const [streaming,  setStreaming]  = useState(false);

  // ── Plan generation state (intent + plan-gen) ──────────────────────────────
  const [classifying,    setClassifying]    = useState(false); // intent classification phase
  const [generatingPlan, setGeneratingPlan] = useState(false); // actual plan generation phase

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
  const planAbortRef        = useRef<AbortController | null>(null);
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

  // ── "Agent done" notifications ────────────────────────────────────────────
  // Fires when a non-conductor terminal returns to a shell prompt after 2 s idle.
  // Runs regardless of the live-feed toggle so the user always sees completions.
  useEffect(() => {
    const unsubscribers: (() => void)[] = [];

    groupSessions.forEach(session => {
      bufferWatcher.watchForIdle(session.id, () => {
        setMessages(prev => [...prev, {
          id:           crypto.randomUUID(),
          role:         'system' as const,
          content:      `✅ ${session.title} returned to shell prompt — agent finished`,
          sessionTitle: session.title,
          sessionColor: session.color,
        }]);
      }).then(unsub => unsubscribers.push(unsub));
    });

    return () => { unsubscribers.forEach(fn => fn()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupSessionIds]);

  useEffect(() => {
    if (!aiEnabled || !liveFeedOn) return;

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
  }, [aiEnabled, liveFeedOn, groupSessionIds, llmProviders.routing]);

  // ── NeedsBroker wiring ────────────────────────────────────────────────────
  useEffect(() => {
    if (!aiEnabled || !activeSpaceId) return;

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
  }, [aiEnabled, activeSpaceId, groupSessionIds]);

  // ── Autonomous mode effect ────────────────────────────────────────────────
  useEffect(() => {
    if (!aiEnabled || !autoModeOn || !activeSpaceId) return;

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
  }, [aiEnabled, autoModeOn, activeSpaceId, groupSessionIds]);

  // ── Conductor engine log → chat feed (via window event from RightPanel) ──
  // The engine subscription itself now lives in RightPanel so both tabs share
  // the same live plan; RightPanel re-emits log entries for this panel to render.
  useEffect(() => {
    const onLog = (e: Event) => {
      const entry = (e as CustomEvent<ConductorLogEntry>).detail;
      if (!entry) return;
      if (entry.workspaceId && entry.workspaceId !== workspaceId) return;
      setMessages(prev => [...prev, {
        id:            crypto.randomUUID(),
        role:          'conductor',
        content:       entry.message,
        conductorType: entry.type,
        taskOutput:    entry.taskOutput,
        agentTitle:    entry.agentTitle,
      }]);
    };
    window.addEventListener('orchaterm:conductor-log', onLog as EventListener);
    return () => window.removeEventListener('orchaterm:conductor-log', onLog as EventListener);
  }, [workspaceId]);

  // ── Send message ──────────────────────────────────────────────────────────

  const handleSend = useCallback((overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || streaming || classifying || generatingPlan) return;

    if (!aiEnabled) {
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'system', content: '⚠ AI features are disabled. Enable them in Settings to chat.' }]);
      setInput('');
      return;
    }

    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    // ── Intent Classification & Autonomous Routing ──────────────────────────
    setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'user', content: text }]);
    setClassifying(true);

    const planAbort = new AbortController();
    planAbortRef.current = planAbort;

    const { system: intentSystem, userContent: intentContent } = buildIntentClassifyPrompt(text);
    llmProviders.planGen.complete([{ role: 'user', content: intentContent }], intentSystem).then(res => {
      if (planAbort.signal.aborted) return;
      const intent = /\bplan\b/.test(res.toLowerCase().trim()) ? 'plan' : 'chat';
      if (intent === 'plan') {
        setClassifying(false);
        setGeneratingPlan(true);
        // Plan generation mode — hand off to the parent (RightPanel) via onPendingPlan.
        const { system: planSystem, userContent: planContent } = buildPlanGenPrompt(
          text, groupSessions.map(s => ({ title: s.title })),
        );
        llmProviders.planGen.complete([{ role: 'user', content: planContent }], planSystem).then(planRes => {
          if (planAbort.signal.aborted) return;
          const { goal: extractedGoal, tasks: rawTasks } = parsePlanGenResponse(planRes, text);
          const idMap = new Map<string, string>();
          rawTasks.forEach(t => idMap.set(t.title, crypto.randomUUID()));

          const tasks: OrchestratorTask[] = rawTasks.map((t: RawPlanTask, idx: number) => {
            const session = groupSessions.find(s =>
              s.title.toLowerCase() === t.assignedSessionTitle.toLowerCase()
            ) ?? groupSessions[0];
            let dependsOn = t.dependsOn
              .map(depTitle => idMap.get(depTitle) ?? '')
              .filter(Boolean);

            // If AI left dependsOn empty for step 2+ but user prompt implies sequential steps or answering, chain to prior step
            if (idx > 0 && dependsOn.length === 0 && /\b(then|after|next|second|follow|->|answer|reply|respond|afterwards)\b/i.test(text)) {
              const prevId = idMap.get(rawTasks[idx - 1].title);
              if (prevId) dependsOn = [prevId];
            }

            return {
              id:                   idMap.get(t.title)!,
              title:                t.title,
              description:          t.description,
              assignedSessionId:    session?.id    ?? '',
              assignedSessionTitle: session?.title ?? t.assignedSessionTitle,
              dependsOn,
              status: 'pending' as const,
            };
          });

          if (onPendingPlan) {
            onPendingPlan(extractedGoal, tasks);
            setMessages(prev => [...prev, {
              id: crypto.randomUUID(), role: 'system',
              content: `🔀 Plan generated — view it in the Pipeline tab (${tasks.length} task${tasks.length !== 1 ? 's' : ''})`,
            }]);
          } else {
            setMessages(prev => [...prev, {
              id: crypto.randomUUID(), role: 'system',
              content: `Plan generated — ${tasks.length} task${tasks.length !== 1 ? 's' : ''}`,
            }]);
          }
        }).catch((err: Error) => {
          if (planAbort.signal.aborted) return;
          setMessages(prev => [...prev, {
            id: crypto.randomUUID(), role: 'system',
            content: `⚠ Plan generation failed: ${err.message}`,
          }]);
        }).finally(() => {
          planAbortRef.current = null;
          setGeneratingPlan(false);
        });
      } else {
        // Chat mode — classification done, route straight to streaming
        setClassifying(false);
        planAbortRef.current = null;
        streamingContentRef.current = '';

        const assistantId                  = crypto.randomUUID();
        const assistantMsg: DisplayMessage = { id: assistantId, role: 'assistant', content: '', streaming: true };

        setMessages(prev => [...prev, assistantMsg]);
        const newHistory: ChatMessage[] = [...apiHistory, { role: 'user', content: text }];
        setApiHistory(newHistory);
        setStreaming(true);
        setProviderOnline(true); // optimistic

        // Snapshot each session's buffer at send time so the LLM can answer
        // questions about terminal output without the user having to paste it.
        const sessionOutputs = groupSessions.map(s => ({
          title:   s.title,
          content: stripAnsiCodes(bufferWatcher.getBuffer(s.id)).slice(-2000).trim(),
        }));

        const systemPrompt = buildSystemPrompt(
          workspace?.name ?? workspaceId,
          activeSpace?.name ?? null,
          groupSessions.map(s => s.title),
          sessionOutputs,
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
              setProviderOnline(false);
              setMessages(prev =>
                prev.map(m => m.id === assistantId ? { ...m, content: `Error: ${err}`, streaming: false } : m),
              );
              cancelRef.current = null;
            },
          }
        );

        cancelRef.current = cancel;
      }
    }).catch((err: Error) => {
      planAbortRef.current = null;
      setClassifying(false);
      setGeneratingPlan(false);
      if ((err as any)?.name === 'AbortError') return;
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(), role: 'system',
        content: `⚠ Request failed: ${err.message}`,
      }]);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, streaming, classifying, generatingPlan, settings, workspace, activeSpace, groupSessions, apiHistory, workspaceId, llmProviders, onPendingPlan]);

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

  const handleCancelPlan = () => {
    planAbortRef.current?.abort();
    planAbortRef.current = null;
    setClassifying(false);
    setGeneratingPlan(false);
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
      if (m.role === 'assistant')     return `**${providerLabel}** (${today}):\n${m.content}\n`;
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

  const effectiveChatModel = settings.llmProviderMode === 'simple'
    ? settings.simpleLlmProvider?.model
    : settings.llmProviders?.chat?.model;
  const modelMissing = !effectiveChatModel;

  // ── Render ────────────────────────────────────────────────────────────────

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
          {/* AI master switch — mirrors Settings → AI Features */}
          <button
            className={cx(s.aiToggle, aiEnabled && s.aiToggleOn)}
            onClick={() => updateSettings({ aiEnabled: !aiEnabled })}
            title={aiEnabled
              ? 'AI features ON — click to disable (use as a plain terminal)'
              : 'AI features OFF — click to enable'}
          >
            <Sparkles size={11} />
            <span>{aiEnabled ? 'AI On' : 'AI Off'}</span>
          </button>
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
          {/* Provider status */}
          {providerOnline === false && (
            <span className={s.offlineBadge}><WifiOff size={10} /> Offline</span>
          )}
          {providerOnline === true && (
            <span className={s.onlineBadge}>
              <span className={s.onlineDot} /> {providerLabel}
            </span>
          )}
          <button
            className={s.refreshBtn}
            onClick={checkOnline}
            disabled={checking}
            title={`Check ${providerLabel} connection`}
          >
            <RefreshCw size={11} className={cx(checking && s.spin)} />
          </button>

        </div>
      </div>

      {/* Disabled overlay — AI features off. Header (with the AI toggle) sits above it. */}
      {!aiEnabled && (
        <div className={s.disabledOverlay}>
          <div className={s.disabledScrim} />
          <div className={s.disabledCard}>
            <Sparkles size={20} className={s.disabledIcon} />
            <p className={s.disabledTitle}>AI features are off</p>
            <p className={s.disabledHint}>
              Orchaterm is running as a plain terminal. No LLM calls are made.
            </p>
            <button className={s.disabledEnableBtn} onClick={() => updateSettings({ aiEnabled: true })}>
              Enable AI
            </button>
          </div>
        </div>
      )}

      {/* Warning banners */}
      {modelMissing && (
        <div className={s.warningBanner}>
          ⚠ No chat model configured — go to <strong>Settings → LLM Providers</strong> to configure one.
        </div>
      )}
      {providerOnline === false && !modelMissing && (
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
            <p className={s.emptyHint}>
              Ask anything about your terminals, tasks, or workflow.
              Describe a multi-step goal and the plan will appear in the Pipeline tab.
            </p>
            <div className={s.suggestions}>
              {getSuggestions(groupSessions.map(s => s.title)).map(suggestion => (
                <button
                  key={suggestion}
                  className={s.suggestionBtn}
                  onClick={() => handleSend(suggestion)}
                  disabled={modelMissing || providerOnline === false}
                >
                  {suggestion}
                </button>
              ))}
            </div>
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
        {/* Thinking / plan generating indicator */}
        {(classifying || generatingPlan) && (
          <div className={s.planThinking}>
            <span className={s.planThinkingDot} />
            <span className={s.planThinkingDot} style={{ animationDelay: '0.2s' }} />
            <span className={s.planThinkingDot} style={{ animationDelay: '0.4s' }} />
            <span className={s.planThinkingLabel}>{generatingPlan ? 'Generating plan…' : 'Thinking…'}</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {showScrollBtn && (
        <button className={s.scrollBtn} onClick={() => scrollToBottom()}>
          <ChevronDown size={14} />
        </button>
      )}

      {/* Features bar */}
      {!modelMissing && (
        <div className={s.inputModeBar}>
          <div className={s.modeLabelRow}>
            <span className={s.modeLabel}>Chat</span>
          </div>
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
        </div>
      )}

      {/* Chat input area */}
      <div className={s.inputArea}>
        <textarea
          ref={textareaRef}
          className={s.textarea}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={
            modelMissing
              ? `Configure a ${providerLabel} model in Settings first…`
              : classifying
              ? 'Thinking…'
              : generatingPlan
              ? 'Generating plan…'
              : streaming
              ? `${providerLabel} is responding…`
              : providerOnline === false
              ? `${providerLabel} offline — check connection`
              : 'Ask anything or describe a goal — ↵ send, Shift+↵ newline'
          }
          disabled={modelMissing || providerOnline === false || classifying || generatingPlan}
          rows={1}
        />
        {classifying || generatingPlan ? (
          <button className={cx(s.sendBtn, s.stopBtn)} onClick={handleCancelPlan} title="Cancel"><Square size={12} fill="currentColor" strokeWidth={0} /></button>
        ) : streaming ? (
          <button className={cx(s.sendBtn, s.stopBtn)} onClick={handleStop} title="Stop"><Square size={12} fill="currentColor" strokeWidth={0} /></button>
        ) : (
          <button
            className={s.sendBtn}
            onClick={() => handleSend()}
            disabled={!input.trim() || modelMissing || providerOnline === false || generatingPlan}
            title="Send (Enter)"
          >
            <Send size={13} />
          </button>
        )}
      </div>
    </div>
  );
};

// ── MessageRow ─────────────────────────────────────────────────────────────────

const MessageRow: React.FC<{
  msg: DisplayMessage;
  onSaveToVault: () => void;
}> = ({ msg, onSaveToVault }) => {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied]   = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  if (msg.role === 'conductor') {
    const icons: Record<string, string> = {
      dispatch: '→', sentinel: '✓', relay: '⚡',
      error: '✗', timeout: '⏱', info: 'ℹ', 'user-override': '⚙',
    };
    const colors: Record<string, string> = {
      dispatch: 'var(--color-brand)', sentinel: 'var(--color-success)', relay: 'var(--color-info)',
      error: 'var(--color-error)', timeout: 'var(--color-warning)', info: 'var(--text-tertiary)', 'user-override': 'var(--color-warning)',
    };
    const type = msg.conductorType ?? 'info';

    // Sentinel with full task output → rich agent report card
    if (type === 'sentinel' && msg.taskOutput) {
      const out = msg.taskOutput;
      const cardStyle = css`
        margin: 4px 0;
        padding: 10px 12px;
        border-radius: var(--border-radius-sm);
        border: 1px solid rgba(var(--color-success-rgb), 0.2);
        background: rgba(var(--color-success-rgb), 0.05);
        font-size: 12px;
        line-height: 1.5;
      `;
      const headerStyle = css`
        display: flex; align-items: center; gap: 6px;
        font-weight: 600; color: var(--color-success); margin-bottom: 6px;
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
        <span className={s.conductorIcon} style={{ color: colors[type] ?? 'var(--text-tertiary)' }}>
          {icons[type] ?? '·'}
        </span>
        <span className={s.conductorText}>{msg.content}</span>
      </div>
    );
  }

  if (msg.role === 'agent-summary') {
    return (
      <div className={s.agentSummaryRow}>
        <span className={s.agentSummaryDot} style={{ backgroundColor: msg.sessionColor ?? 'var(--text-tertiary)' }} />
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
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {msg.content}
        {hovered && (
          <button className={s.actionBtn} onClick={handleCopy} title="Copy" style={{ position: 'absolute', top: -8, right: -8 }}>
            {copied ? <Check size={11} /> : <Copy size={11} />}
          </button>
        )}
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
        {!msg.streaming && hovered && (
          <div className={cx(s.msgActions, msg.role === 'user' && s.msgActionsUser)}>
            <button className={s.actionBtn} onClick={handleCopy} title="Copy">
              {copied ? <Check size={11} /> : <Copy size={11} />}
            </button>
            <button className={s.actionBtn} onClick={onSaveToVault} title="Save to Prompt Vault">
              <BookmarkPlus size={11} />
            </button>
          </div>
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
    background: var(--bg-canvas); overflow: hidden; position: relative;
  `,

  /* ── Features bar ── */
  inputModeBar: css`
    display: flex; align-items: center; justify-content: space-between;
    padding: 5px 10px 5px 12px;
    border-top: 1px solid var(--border-color);
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-secondary);
    flex-shrink: 0;
  `,
  modeLabelRow: css`
    display: flex; align-items: center; gap: 6px;
    font-size: 11px; color: var(--text-tertiary); font-weight: 600;
  `,
  modeLabel: css`
    font-size: 11px; color: var(--text-tertiary); font-weight: 600;
  `,
  inputModeIconBtn: css`
    display: flex; align-items: center; justify-content: center;
    width: 26px; height: 26px;
    border-radius: 7px;
    color: var(--text-tertiary);
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    transition: all 0.15s;
    &:hover { color: var(--text-secondary); border-color: var(--border-color); }
  `,
  inputModeIconBtnActive: css`
    color: var(--color-brand) !important;
    background: rgba(var(--color-brand-rgb), 0.12) !important;
    border-color: rgba(var(--color-brand-rgb), 0.3) !important;
  `,
  featuresPopoverUp: css`
    top: auto !important;
    bottom: calc(100% + 6px) !important;
  `,

  header: css`
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 12px; border-bottom: 1px solid var(--border-color);
    background: var(--bg-secondary); flex-shrink: 0; gap: 8px;
    /* Sit above the disabled overlay so the AI toggle stays usable when AI is off. */
    position: relative; z-index: 30;
  `,

  /* ── Disabled overlay (AI features off) ── */
  disabledOverlay: css`
    position: absolute; inset: 0; z-index: 20;
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
  `,
  disabledScrim: css`
    position: absolute; inset: 0;
    background: var(--bg-canvas);
    opacity: 0.62;
    backdrop-filter: grayscale(0.6);
  `,
  disabledCard: css`
    position: relative; z-index: 1;
    display: flex; flex-direction: column; align-items: center; text-align: center;
    gap: 8px; max-width: 260px;
    padding: 20px 22px;
    border: 1px solid var(--border-color);
    border-radius: 12px;
    background: var(--bg-secondary);
    box-shadow: var(--shadow-md);
  `,
  disabledIcon: css`color: var(--text-tertiary);`,
  disabledTitle: css`font-size: 13px; font-weight: 700; color: var(--text-primary);`,
  disabledHint: css`font-size: 12px; color: var(--text-tertiary); line-height: 1.5;`,
  disabledEnableBtn: css`
    margin-top: 4px;
    display: inline-flex; align-items: center; gap: 6px;
    padding: 7px 14px; border-radius: 8px; border: none; cursor: pointer;
    font-size: 12px; font-weight: 700;
    background: var(--color-brand); color: white;
    transition: filter 0.15s;
    &:hover { filter: brightness(1.08); }
  `,
  headerLeft: css`display: flex; align-items: center; gap: 7px; min-width: 0; flex: 1; overflow: hidden;`,
  headerRight: css`display: flex; align-items: center; gap: 4px; flex-shrink: 0;`,
  botIcon: css`color: var(--color-brand); flex-shrink: 0;`,
  headerTitle: css`font-size: 12px; font-weight: 700; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`,
  groupBadge: css`
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 10px; font-weight: 600; padding: 1px 6px;
    border-radius: 99px; border: 1px solid; flex-shrink: 0; cursor: default;
    opacity: 0.85;
  `,
  headerIconBtn: css`
    width: 24px; height: 24px; border-radius: 5px; border: none;
    background: transparent; color: var(--text-tertiary); cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 150ms ease;
    &:hover { background: var(--bg-hover); color: var(--text-primary); }
  `,
  aiToggle: css`
    display: flex; align-items: center; gap: 4px;
    height: 24px; padding: 0 8px; border-radius: 6px;
    border: 1px solid var(--border-color);
    background: transparent; color: var(--text-tertiary);
    font-size: 10px; font-weight: 700; letter-spacing: 0.02em;
    cursor: pointer; flex-shrink: 0;
    transition: all 150ms ease;
    &:hover { background: var(--bg-hover); color: var(--text-secondary); }
  `,
  aiToggleOn: css`
    color: var(--color-brand);
    border-color: rgba(var(--color-brand-rgb), 0.4);
    background: rgba(var(--color-brand-rgb), 0.08);
    &:hover { background: rgba(var(--color-brand-rgb), 0.14); color: var(--color-brand); }
  `,
  onlineBadge: css`display: flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 600; color: var(--color-success);`,
  onlineDot: css`
    width: 5px; height: 5px; border-radius: 50%; background: var(--color-success);
    animation: blink 2.5s ease-in-out infinite;
    @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
  `,
  offlineBadge: css`display: flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 600; color: var(--color-error);`,
  refreshBtn: css`
    width: 22px; height: 22px; border-radius: 5px; border: none;
    background: transparent; color: var(--text-tertiary); cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 150ms ease;
    &:hover { background: var(--bg-hover); color: var(--text-primary); }
    &:disabled { opacity: 0.4; cursor: default; }
  `,
  spin: css`animation: spin 0.8s linear infinite; @keyframes spin { to { transform: rotate(360deg); } }`,
  warningBanner: css`
    background: rgba(var(--color-warning-rgb), 0.07); border-bottom: 1px solid rgba(var(--color-warning-rgb), 0.2);
    padding: 8px 14px; font-size: 11px; color: var(--color-warning); flex-shrink: 0; line-height: 1.5;
    code { font-family: var(--font-family-mono); color: var(--color-warning); }
    strong { color: var(--color-warning); }
  `,
  inlineLinkBtn: css`
    background: transparent; border: none; color: var(--color-warning);
    text-decoration: underline; cursor: pointer; font-size: inherit; padding: 0;
    &:hover { color: var(--text-primary); }
  `,
  messageList: css`
    flex: 1; overflow-y: auto; padding: 14px 12px;
    display: flex; flex-direction: column; gap: 10px;
    scroll-behavior: smooth;
    &::-webkit-scrollbar { width: 4px; }
    &::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 2px; }
  `,
  emptyState: css`
    flex: 1; display: flex; flex-direction: column; align-items: center;
    justify-content: center; text-align: center; padding: 40px 24px;
    gap: 8px; margin: auto 0;
  `,
  emptyIcon: css`color: var(--border-color-hover); margin-bottom: 4px;`,
  emptyTitle: css`font-size: 13px; font-weight: 700; color: var(--text-tertiary); margin: 0;`,
  emptyHint: css`font-size: 11px; color: var(--text-tertiary); line-height: 1.5; margin: 0; max-width: 260px; opacity: 0.8;`,
  suggestions: css`
    display: flex; flex-direction: column; gap: 6px; margin-top: 12px; width: 100%; max-width: 280px;
  `,
  suggestionBtn: css`
    background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 8px;
    color: var(--text-tertiary); font-size: 11px; padding: 8px 12px; cursor: pointer;
    text-align: left; transition: all 150ms ease; line-height: 1.4; width: 100%;
    &:hover:not(:disabled) { border-color: var(--color-brand); color: var(--text-primary); background: rgba(var(--color-brand-rgb), 0.08); }
    &:disabled { opacity: 0.4; cursor: not-allowed; }
  `,
  msgRow: css`display: flex; align-items: flex-end; gap: 8px; position: relative;`,
  msgRowUser: css`flex-direction: row-reverse;`,
  msgRowAssistant: css`flex-direction: row;`,
  avatar: css`
    width: 22px; height: 22px; border-radius: 50%;
    background: var(--bg-tertiary); border: 1px solid var(--border-color);
    display: flex; align-items: center; justify-content: center;
    color: var(--color-brand); flex-shrink: 0;
  `,
  avatarUser: css`background: rgba(var(--color-brand-rgb), 0.10); border-color: rgba(var(--color-brand-rgb), 0.28);`,
  bubble: css`
    max-width: 82%; padding: 9px 12px; border-radius: 10px;
    font-size: 12px; line-height: 1.6; word-break: break-word; position: relative;
  `,
  bubbleUser: css`
    background: rgba(var(--color-brand-rgb), 0.12); border: 1px solid rgba(var(--color-brand-rgb), 0.22);
    border-bottom-right-radius: 3px; color: var(--text-primary);
  `,
  bubbleAssistant: css`
    background: var(--bg-tertiary); border: 1px solid var(--border-color);
    border-bottom-left-radius: 3px; color: var(--text-primary);
  `,
  msgText: css`margin: 0; font-size: inherit; line-height: 1.6;`,
  cursor: css`
    display: inline-block; width: 6px; height: 12px; background: var(--color-brand);
    border-radius: 1px; margin-left: 2px; vertical-align: text-bottom;
    animation: blink2 0.8s step-end infinite;
    @keyframes blink2 { 0%,100%{opacity:1} 50%{opacity:0} }
  `,
  msgActions: css`
    position: absolute; top: -8px; right: -8px;
    display: flex; flex-direction: row-reverse; gap: 3px;
  `,
  msgActionsUser: css`right: auto; left: -8px; flex-direction: row;`,
  actionBtn: css`
    width: 20px; height: 20px; border-radius: 50%;
    background: var(--bg-secondary); border: 1px solid var(--border-color);
    color: var(--text-tertiary); cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 150ms ease;
    &:hover { border-color: var(--color-brand); color: var(--color-brand); }
  `,
  agentSummaryRow: css`
    display: flex; align-items: baseline; gap: 6px;
    padding: 4px 8px; background: var(--bg-tertiary);
    border-radius: 5px; border-left: 2px solid var(--border-color);
  `,
  agentSummaryDot: css`width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; margin-top: 3px;`,
  agentSummaryTitle: css`font-size: 10px; font-weight: 600; color: var(--text-tertiary); white-space: nowrap; flex-shrink: 0;`,
  agentSummaryText: css`font-size: 11px; color: var(--text-secondary); line-height: 1.4;`,
  systemRow: css`
    font-size: 11px; color: var(--text-secondary); padding: 5px 10px;
    border-left: 2px solid var(--border-color); border-radius: 3px;
    background: var(--bg-tertiary); line-height: 1.4; position: relative;
  `,
  scrollBtn: css`
    position: absolute; bottom: 70px; right: 14px;
    width: 26px; height: 26px; border-radius: 50%;
    border: 1px solid var(--border-color); background: var(--bg-secondary); color: var(--text-tertiary);
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    box-shadow: var(--shadow-md); transition: all 150ms ease;
    &:hover { border-color: var(--border-color-hover); color: var(--text-primary); }
  `,
  inputArea: css`
    display: flex; align-items: flex-end; gap: 8px;
    padding: 10px 12px; border-top: 1px solid var(--border-color);
    background: var(--bg-secondary); flex-shrink: 0;
  `,
  textarea: css`
    flex: 1; background: var(--bg-input); border: 1px solid var(--border-color-hover);
    border-radius: 8px; padding: 8px 12px; color: var(--text-primary);
    font-size: 12px; font-family: inherit; line-height: 1.5;
    resize: none; outline: none; max-height: 120px; min-height: 36px;
    transition: border-color 150ms ease;
    &:focus { border-color: var(--border-color-focus); }
    &::placeholder { color: var(--text-tertiary); }
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
  stopBtn: css`
    background: transparent !important;
    border: 1px solid var(--color-error) !important;
    color: var(--color-error) !important;
    &:hover { background: rgba(var(--color-error-rgb), 0.12) !important; filter: none; }
  `,

  // ── Conductor event row ──────────────────────────────────────────────────
  conductorRow: css`
    display: flex; align-items: baseline; gap: 7px;
    padding: 3px 10px; border-radius: 4px;
    background: rgba(var(--color-brand-rgb), 0.04);
    border-left: 2px solid rgba(var(--color-brand-rgb), 0.2);
  `,
  conductorIcon: css`font-size: 11px; font-weight: 700; flex-shrink: 0; min-width: 12px; text-align: center;`,
  conductorText: css`font-size: 11px; color: var(--text-secondary); line-height: 1.4;`,

  // ── Plan mode ────────────────────────────────────────────────────────────
  planThinking: css`
    display: flex; align-items: center; gap: 5px;
    padding: 8px 12px; border-radius: 6px;
    background: rgba(var(--color-info-rgb), 0.06); border: 1px solid rgba(var(--color-info-rgb), 0.2);
  `,
  planThinkingDot: css`
    width: 5px; height: 5px; border-radius: 50%; background: var(--color-info);
    animation: planPulse 1.2s ease-in-out infinite;
    @keyframes planPulse { 0%,100%{opacity:0.2;transform:scale(0.8)} 50%{opacity:1;transform:scale(1)} }
  `,
  planThinkingLabel: css`font-size: 11px; color: var(--color-info); margin-left: 4px;`,

  // ── Features popover ─────────────────────────────────────────────────────
  featuresPopover: css`
    position: absolute; top: calc(100% + 6px); right: 0;
    width: 240px; background: var(--bg-secondary);
    border: 1px solid var(--border-color); border-radius: 10px;
    box-shadow: var(--shadow-lg);
    overflow: hidden; z-index: 50;
  `,
  featureSection: css`
    padding: 10px 0 6px;
    & + & { border-top: 1px solid var(--border-color); }
  `,
  featureSectionLabel: css`
    display: block; font-size: 10px; font-weight: 600;
    color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.06em;
    padding: 0 14px 6px;
  `,
  featureOption: css`
    display: flex; align-items: flex-start; gap: 10px;
    width: 100%; padding: 7px 14px; border: none;
    background: transparent; cursor: pointer; text-align: left;
    transition: background 120ms ease;
    &:hover { background: var(--bg-hover); }
  `,
  featureOptionActiveGreen: css`background: rgba(var(--color-success-rgb), 0.08) !important;`,
  featureOptionActiveYellow: css`background: rgba(var(--color-warning-rgb), 0.08) !important;`,
  featureOptionCheck: css`
    width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0; margin-top: 1px;
    border: 1px solid var(--border-color-hover); background: var(--bg-input);
    display: flex; align-items: center; justify-content: center; color: var(--text-primary);
  `,
  featureOptionContent: css`display: flex; flex-direction: column; gap: 1px; min-width: 0;`,
  featureOptionTitle: css`font-size: 12px; font-weight: 500; color: var(--text-primary);`,
  featureOptionDesc: css`font-size: 10px; color: var(--text-tertiary); line-height: 1.4;`,
};
