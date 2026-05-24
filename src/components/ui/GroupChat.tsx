/**
 * GroupChat.tsx
 *
 * Streaming Ollama chat panel scoped to the active Agent Group.
 * System prompt gives Ollama context about the workspace, the active group,
 * and the terminal sessions in that group.
 *
 * User messages appear on the right (amber), Ollama responses on the left (slate).
 * Responses stream token-by-token.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { css, cx } from '@emotion/css';
import { Send, Bot, User, WifiOff, RefreshCw, Users, ChevronDown } from 'lucide-react';
import { useDashboard } from '../../context/DashboardContext';
import { streamChatWithOllama, ChatMessage, checkOllamaOnline } from '../../services/ollamaRelay';

// ── Props ──────────────────────────────────────────────────────────────────────

interface GroupChatProps {
  workspaceId: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildSystemPrompt(
  workspaceName: string,
  groupName: string | null,
  sessionTitles: string[],
): string {
  const groupLine = groupName
    ? `Active Space: "${groupName}"`
    : 'No space is currently selected.';

  const sessionsLine = sessionTitles.length > 0
    ? `Terminal sessions in this space:\n${sessionTitles.map(t => `  • ${t}`).join('\n')}`
    : 'No terminal sessions are currently assigned to this space.';

  return `You are an AI orchestration assistant embedded inside AgentDeck, a developer workspace management tool.

Workspace: "${workspaceName}"
${groupLine}
${sessionsLine}

Your job: help the developer plan, coordinate, and execute work across their terminal sessions. Be concise, direct, and practical. Think like a senior engineer and a tech lead — not a chatbot. Avoid filler, avoid markdown headers, keep answers short unless depth is needed.`;
}

// ── Display message ────────────────────────────────────────────────────────────

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

// ── Component ──────────────────────────────────────────────────────────────────

export const GroupChat: React.FC<GroupChatProps> = ({ workspaceId }) => {
  const {
    workspaces, spaces, terminalSessions,
    activeSpaceId, settings,
  } = useDashboard();

  const workspace    = workspaces.find(w => w.id === workspaceId);
  const activeSpace  = spaces.find(g => g.id === activeSpaceId);
  const allSessions  = terminalSessions.filter(s => s.workspaceId === workspaceId);
  const groupSessions = activeSpace
    ? allSessions.filter(s => activeSpace.sessionIds.includes(s.id))
    : allSessions;

  // ── Ollama status ─────────────────────────────────────────────────────────
  const [ollamaOnline, setOllamaOnline] = useState<boolean | null>(null);
  const [checking, setChecking]         = useState(false);

  const checkOnline = useCallback(async () => {
    if (!settings.ollamaHost) { setOllamaOnline(false); return; }
    setChecking(true);
    const ok = await checkOllamaOnline(settings.ollamaHost);
    setOllamaOnline(ok);
    setChecking(false);
  }, [settings.ollamaHost]);

  useEffect(() => { checkOnline(); }, [checkOnline]);

  // ── Message history ───────────────────────────────────────────────────────
  const [messages,   setMessages]   = useState<DisplayMessage[]>([]);
  const [apiHistory, setApiHistory] = useState<ChatMessage[]>([]);
  const [input,      setInput]      = useState('');
  const [streaming,  setStreaming]  = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const scrollToBottom = (smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' });
  };

  useEffect(() => {
    if (!streaming) scrollToBottom();
  }, [messages.length, streaming]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distFromBottom > 120);
  };

  // ── Send message ──────────────────────────────────────────────────────────

  const handleSend = () => {
    const text = input.trim();
    if (!text || streaming) return;
    if (!settings.conductorOllamaModel) return;

    setInput('');
    // Reset textarea height
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const userMsg: DisplayMessage = {
      id: crypto.randomUUID(), role: 'user', content: text,
    };
    const assistantId = crypto.randomUUID();
    const assistantMsg: DisplayMessage = {
      id: assistantId, role: 'assistant', content: '', streaming: true,
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);

    const newApiHistory: ChatMessage[] = [...apiHistory, { role: 'user', content: text }];
    setApiHistory(newApiHistory);
    setStreaming(true);
    setOllamaOnline(true); // optimistic

    const systemPrompt = buildSystemPrompt(
      workspace?.name ?? workspaceId,
      activeSpace?.name ?? null,
      groupSessions.map(s => s.title),
    );

    const cancel = streamChatWithOllama({
      ollamaHost: settings.ollamaHost,
      model:      settings.conductorOllamaModel,
      systemPrompt,
      messages:   newApiHistory,
      onToken: (token) => {
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId ? { ...m, content: m.content + token } : m,
          ),
        );
      },
      onDone: () => {
        setStreaming(false);
        setMessages(prev =>
          prev.map(m => m.id === assistantId ? { ...m, streaming: false } : m),
        );
        // Add completed assistant message to api history
        setMessages(current => {
          const finishedMsg = current.find(m => m.id === assistantId);
          if (finishedMsg) {
            setApiHistory(h => [...h, { role: 'assistant', content: finishedMsg.content }]);
          }
          return current;
        });
        cancelRef.current = null;
        scrollToBottom();
      },
      onError: (err) => {
        setStreaming(false);
        setOllamaOnline(false);
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId
              ? { ...m, content: `Error: ${err}`, streaming: false }
              : m,
          ),
        );
        cancelRef.current = null;
      },
    });

    cancelRef.current = cancel;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Auto-grow textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  };

  const handleStop = () => {
    cancelRef.current?.();
    cancelRef.current = null;
    setStreaming(false);
    setMessages(prev =>
      prev.map(m => m.streaming ? { ...m, streaming: false } : m),
    );
  };

  // ── No model configured ───────────────────────────────────────────────────

  const modelMissing = !settings.conductorOllamaModel;

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
            <span className={s.groupBadge} style={{ backgroundColor: activeSpace.color + '22', color: activeSpace.color, borderColor: activeSpace.color + '44' }}>
              <Users size={9} />
              {groupSessions.length} session{groupSessions.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Ollama status */}
        <div className={s.statusRow}>
          {ollamaOnline === false && (
            <span className={s.offlineBadge}>
              <WifiOff size={10} />
              Offline
            </span>
          )}
          {ollamaOnline === true && (
            <span className={s.onlineBadge}>
              <span className={s.onlineDot} />
              Ollama
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
        </div>
      </div>

      {/* Warning banners */}
      {modelMissing && (
        <div className={s.warningBanner}>
          <span>⚠ No Ollama model configured — go to Settings → Conductor Settings to pick one.</span>
        </div>
      )}
      {ollamaOnline === false && !modelMissing && (
        <div className={s.warningBanner}>
          <span>⚠ Ollama is offline at <code>{settings.ollamaHost}</code> — start it to enable chat.</span>
        </div>
      )}

      {/* Message list */}
      <div className={s.messageList} onScroll={handleScroll}>
        {messages.length === 0 && (
          <div className={s.emptyState}>
            <Bot size={28} className={s.emptyIcon} />
            <p className={s.emptyTitle}>
              {activeSpace ? `Orchestrating "${activeSpace.name}"` : 'Workspace AI'}
            </p>
            <p className={s.emptyHint}>
              Ask anything about your terminals, tasks, or workflow.
              {activeSpace && groupSessions.length > 0 && (
                <span> Ollama knows about {groupSessions.length} session{groupSessions.length !== 1 ? 's' : ''} in this group.</span>
              )}
            </p>
          </div>
        )}

        {messages.map(msg => (
          <div
            key={msg.id}
            className={cx(s.msgRow, msg.role === 'user' ? s.msgRowUser : s.msgRowAssistant)}
          >
            {msg.role === 'assistant' && (
              <div className={s.avatar}>
                <Bot size={12} />
              </div>
            )}
            <div className={cx(s.bubble, msg.role === 'user' ? s.bubbleUser : s.bubbleAssistant)}>
              <pre className={s.msgText}>{msg.content || (msg.streaming ? '' : '…')}</pre>
              {msg.streaming && <span className={s.cursor} />}
            </div>
            {msg.role === 'user' && (
              <div className={cx(s.avatar, s.avatarUser)}>
                <User size={12} />
              </div>
            )}
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Scroll-to-bottom button */}
      {showScrollBtn && (
        <button className={s.scrollBtn} onClick={() => scrollToBottom()}>
          <ChevronDown size={14} />
        </button>
      )}

      {/* Input area */}
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
              : streaming
              ? 'Ollama is responding…'
              : 'Ask anything — ↵ to send, Shift+↵ for newline'
          }
          disabled={modelMissing || ollamaOnline === false}
          rows={1}
        />
        {streaming ? (
          <button className={cx(s.sendBtn, s.stopBtn)} onClick={handleStop} title="Stop">
            ■
          </button>
        ) : (
          <button
            className={s.sendBtn}
            onClick={handleSend}
            disabled={!input.trim() || modelMissing || ollamaOnline === false}
            title="Send (Enter)"
          >
            <Send size={13} />
          </button>
        )}
      </div>

    </div>
  );
};

// ── Styles ─────────────────────────────────────────────────────────────────────

const s = {
  root: css`
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #070d14;
    overflow: hidden;
    position: relative;
  `,
  header: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid #0d1c2a;
    background: #0b1520;
    flex-shrink: 0;
  `,
  headerLeft: css`
    display: flex;
    align-items: center;
    gap: 8px;
  `,
  botIcon: css`
    color: #ff9d00;
    flex-shrink: 0;
  `,
  headerTitle: css`
    font-size: 12px;
    font-weight: 700;
    color: #e2e8f0;
  `,
  groupBadge: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 99px;
    border: 1px solid;
  `,
  statusRow: css`
    display: flex;
    align-items: center;
    gap: 6px;
  `,
  onlineBadge: css`
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 10px;
    font-weight: 700;
    color: #10b981;
  `,
  onlineDot: css`
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #10b981;
    animation: blink 2s ease-in-out infinite;
    @keyframes blink {
      0%, 100% { opacity: 1 }
      50%       { opacity: 0.4 }
    }
  `,
  offlineBadge: css`
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    font-weight: 700;
    color: #ef4444;
  `,
  refreshBtn: css`
    width: 22px;
    height: 22px;
    border-radius: 5px;
    border: none;
    background: transparent;
    color: #475569;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 150ms ease;
    &:hover { background: #0d1c2a; color: #94a3b8; }
    &:disabled { opacity: 0.5; cursor: default; }
  `,
  spin: css`
    animation: spin 0.8s linear infinite;
    @keyframes spin { to { transform: rotate(360deg) } }
  `,
  warningBanner: css`
    background: rgba(245, 158, 11, 0.08);
    border-bottom: 1px solid rgba(245, 158, 11, 0.2);
    padding: 8px 14px;
    font-size: 11px;
    color: #f59e0b;
    flex-shrink: 0;
    line-height: 1.4;
    code {
      font-family: 'Fira Code', monospace;
      color: #fbbf24;
    }
  `,
  messageList: css`
    flex: 1;
    overflow-y: auto;
    padding: 16px 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    scroll-behavior: smooth;
    &::-webkit-scrollbar { width: 4px; }
    &::-webkit-scrollbar-thumb { background: #1e3a5f; border-radius: 2px; }
  `,
  emptyState: css`
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 40px 24px;
    gap: 8px;
    color: #475569;
    margin: auto 0;
  `,
  emptyIcon: css`
    color: #1e3a5f;
    margin-bottom: 4px;
  `,
  emptyTitle: css`
    font-size: 13px;
    font-weight: 700;
    color: #64748b;
    margin: 0;
  `,
  emptyHint: css`
    font-size: 11px;
    color: #475569;
    line-height: 1.5;
    margin: 0;
    max-width: 260px;
  `,
  msgRow: css`
    display: flex;
    align-items: flex-end;
    gap: 8px;
  `,
  msgRowUser: css`
    flex-direction: row-reverse;
  `,
  msgRowAssistant: css`
    flex-direction: row;
  `,
  avatar: css`
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: #0d1c2a;
    border: 1px solid #1e3a5f;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ff9d00;
    flex-shrink: 0;
  `,
  avatarUser: css`
    background: rgba(255, 157, 0, 0.1);
    border-color: rgba(255, 157, 0, 0.3);
    color: #ff9d00;
  `,
  bubble: css`
    max-width: 82%;
    padding: 10px 13px;
    border-radius: 12px;
    font-size: 12px;
    line-height: 1.55;
    word-break: break-word;
    position: relative;
  `,
  bubbleUser: css`
    background: rgba(255, 157, 0, 0.12);
    border: 1px solid rgba(255, 157, 0, 0.25);
    border-bottom-right-radius: 3px;
    color: #fde68a;
  `,
  bubbleAssistant: css`
    background: #0d1c2a;
    border: 1px solid #132030;
    border-bottom-left-radius: 3px;
    color: #cbd5e1;
  `,
  msgText: css`
    margin: 0;
    font-family: inherit;
    font-size: inherit;
    white-space: pre-wrap;
    line-height: 1.55;
  `,
  cursor: css`
    display: inline-block;
    width: 7px;
    height: 13px;
    background: #ff9d00;
    border-radius: 1px;
    margin-left: 2px;
    vertical-align: text-bottom;
    animation: blink 0.8s step-end infinite;
    @keyframes blink {
      0%, 100% { opacity: 1 }
      50%       { opacity: 0 }
    }
  `,
  scrollBtn: css`
    position: absolute;
    bottom: 70px;
    right: 16px;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 1px solid #1e3a5f;
    background: #0b1520;
    color: #64748b;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    transition: all 150ms ease;
    &:hover { background: #122030; color: #e2e8f0; }
  `,
  inputArea: css`
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 10px 12px;
    border-top: 1px solid #0d1c2a;
    background: #0b1520;
    flex-shrink: 0;
  `,
  textarea: css`
    flex: 1;
    background: #071018;
    border: 1px solid #1e3a5f;
    border-radius: 8px;
    padding: 9px 12px;
    color: #e2e8f0;
    font-size: 12px;
    font-family: inherit;
    line-height: 1.5;
    resize: none;
    outline: none;
    max-height: 120px;
    min-height: 36px;
    transition: border-color 150ms ease;
    &:focus { border-color: #2d5a8a; }
    &::placeholder { color: #334155; }
    &:disabled { opacity: 0.5; cursor: not-allowed; }
  `,
  sendBtn: css`
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    border-radius: 8px;
    border: none;
    background: #ff9d00;
    color: #070d14;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 700;
    transition: all 150ms ease;
    &:hover:not(:disabled) { background: #ffb733; }
    &:disabled { opacity: 0.35; cursor: not-allowed; }
  `,
  stopBtn: css`
    background: #ef4444;
    color: #fff;
    &:hover { background: #f87171; }
  `,
};
