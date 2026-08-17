import React, { useState, useEffect, useRef } from 'react';
import { css, keyframes } from '@emotion/css';

import {
  Sparkles,
  X,
  Play,
  Square,
  Copy,
  Check,
  Terminal,
  MessageSquare,
  BookmarkPlus,
  RefreshCw,
  Edit3,
  Eye,
  ChevronDown,
  ChevronUp,
  AlertCircle
} from 'lucide-react';
import { useDashboard } from '../../context/DashboardContext';
import { MarkdownViewer } from '../ui/MarkdownViewer';
import type { QuickAction } from '../../types';
import { interpolatePromptTemplate, PromptContext } from '../../utils/promptTemplate';

interface QuickActionPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  action: QuickAction;
  context: PromptContext;
  onInjectToTerminal?: (text: string) => void;
  onSendToChat?: (prompt: string, response?: string) => void;
}

export const QuickActionPromptModal: React.FC<QuickActionPromptModalProps> = ({
  isOpen,
  onClose,
  action,
  context,
  onInjectToTerminal,
  onSendToChat,
}) => {
  const { llmProviders, settings, addSavedPrompt, showToast } = useDashboard();

  // Prompt state
  const [promptText, setPromptText] = useState('');
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const [isPromptCollapsed, setIsPromptCollapsed] = useState(false);

  // Response state
  const [response, setResponse] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const cancelStreamRef = useRef<(() => void) | null>(null);
  const responseEndRef = useRef<HTMLDivElement>(null);

  // Initialize prompt on modal open
  useEffect(() => {
    if (isOpen) {
      const interpolated = interpolatePromptTemplate(action.command, context);
      setPromptText(interpolated);
      setResponse('');
      setError(null);
      setCopied(false);

      if (action.autoExecute) {
        setIsPromptCollapsed(true);
        // Start streaming immediately
        setTimeout(() => {
          handleExecute(interpolated);
        }, 100);
      } else {
        setIsPromptCollapsed(false);
      }
    } else {
      if (cancelStreamRef.current) {
        cancelStreamRef.current();
        cancelStreamRef.current = null;
      }
    }
  }, [isOpen, action, context]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (cancelStreamRef.current) {
        cancelStreamRef.current();
      }
    };
  }, []);

  const handleExecute = (customPrompt?: string) => {
    const textToRun = customPrompt ?? promptText;
    if (!textToRun.trim()) {
      setError('Prompt cannot be empty');
      return;
    }

    if (settings.aiEnabled === false) {
      setError('AI features are disabled in Settings. Enable AI Features to run prompts.');
      return;
    }

    // Cancel any active stream
    if (cancelStreamRef.current) {
      cancelStreamRef.current();
      cancelStreamRef.current = null;
    }

    setResponse('');
    setError(null);
    setIsStreaming(true);

    const provider = llmProviders.chat || llmProviders.autoAnswer;
    if (!provider) {
      setError('No active LLM provider configured.');
      setIsStreaming(false);
      return;
    }

    const systemPrompt = `You are an expert developer AI assistant inside Orchaterm.
Workspace: "${context.workspaceName || 'Current'}"
Space: "${context.spaceName || 'Default'}"
Path: "${context.workspacePath || ''}"

Your task is to respond to the developer's prompt clearly, directly, and accurately using Markdown formatting.
Provide clean code blocks with language identifiers, concise explanations, and actionable solutions.`;

    try {
      const cancel = provider.stream(
        [{ role: 'user', content: textToRun }],
        systemPrompt,
        {
          onToken: (token) => {
            setResponse((prev) => prev + token);
          },
          onDone: () => {
            setIsStreaming(false);
            cancelStreamRef.current = null;
          },
          onError: (err) => {
            setError(err || 'Failed to generate AI response');
            setIsStreaming(false);
            cancelStreamRef.current = null;
          },
        }
      );
      cancelStreamRef.current = cancel;
    } catch (err: any) {
      setError(err?.message || 'Error initiating LLM stream');
      setIsStreaming(false);
    }
  };

  const handleStopStream = () => {
    if (cancelStreamRef.current) {
      cancelStreamRef.current();
      cancelStreamRef.current = null;
    }
    setIsStreaming(false);
  };

  const handleCopyResponse = () => {
    if (!response) return;
    navigator.clipboard.writeText(response);
    setCopied(true);
    showToast('Copied output to clipboard', 'success');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleInjectTerminal = () => {
    if (!response) return;
    // If there is code fence in response, extract inner code if single block, otherwise send full response
    const codeMatch = response.match(/^```[\w]*\n([\s\S]*?)\n```$/);
    const textToInject = codeMatch ? codeMatch[1] : response;
    
    if (onInjectToTerminal) {
      onInjectToTerminal(textToInject);
      showToast('Injected response into terminal', 'success');
      onClose();
    }
  };

  const handleSendToChat = () => {
    if (onSendToChat) {
      onSendToChat(promptText, response);
      showToast('Sent prompt & response to AI Chat', 'success');
      onClose();
    }
  };

  const handleSaveToVault = () => {
    if (!promptText.trim()) return;
    addSavedPrompt({
      title: action.label || 'Quick Action Prompt',
      content: promptText,
      workspaceId: '',
      spaceId: null,
      tags: ['quick-action', 'ai-prompt'],
    });
    showToast('Saved to Prompt Vault', 'success');
  };

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerTitleRow}>
            <div className={styles.iconBadge} style={action.color ? { backgroundColor: `${action.color}22`, color: action.color } : undefined}>
              <Sparkles size={16} />
            </div>
            <div>
              <h3 className={styles.title}>{action.label || 'AI Quick Action'}</h3>
              <span className={styles.subtitle}>
                Model: <code>{settings.simpleLlmProvider?.model || settings.llmProviders?.chat?.model || 'LLM'}</code>
              </span>
            </div>
          </div>
          <button onClick={onClose} className={styles.closeBtn} title="Close (Esc)">
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className={styles.body}>
          {/* Prompt Section (Collapsible) */}
          <div className={styles.promptSection}>
            <div
              className={styles.promptHeader}
              onClick={() => setIsPromptCollapsed(!isPromptCollapsed)}
            >
              <div className={styles.promptHeaderLeft}>
                <span className={styles.sectionLabel}>Input Prompt (Markdown)</span>
                {showPromptPreview && <span className={styles.badgePreview}>Preview Mode</span>}
              </div>
              <div className={styles.promptHeaderActions} onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => setShowPromptPreview(!showPromptPreview)}
                  className={styles.tabToggleBtn}
                  title="Toggle Markdown Preview"
                >
                  {showPromptPreview ? <Edit3 size={13} /> : <Eye size={13} />}
                  <span>{showPromptPreview ? 'Edit' : 'Preview'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsPromptCollapsed(!isPromptCollapsed)}
                  className={styles.collapseBtn}
                  title={isPromptCollapsed ? 'Expand Prompt' : 'Collapse Prompt'}
                >
                  {isPromptCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                </button>
              </div>
            </div>

            {!isPromptCollapsed && (
              <div className={styles.promptContent}>
                {showPromptPreview ? (
                  <div className={styles.promptPreviewBox}>
                    <MarkdownViewer content={promptText} />
                  </div>
                ) : (
                  <textarea
                    value={promptText}
                    onChange={(e) => setPromptText(e.target.value)}
                    rows={4}
                    placeholder="Enter or customize your markdown prompt..."
                    className={styles.promptInput}
                    disabled={isStreaming}
                  />
                )}

                <div className={styles.promptFooter}>
                  <div className={styles.varHints}>
                    <span>Available context: <code>{`{{selection}}`}</code>, <code>{`{{terminal_output}}`}</code></span>
                  </div>
                  <div className={styles.promptControls}>
                    <button
                      type="button"
                      onClick={handleSaveToVault}
                      className={styles.secondaryActionBtn}
                      title="Save this prompt to Prompt Vault"
                    >
                      <BookmarkPlus size={13} />
                      <span>Save to Vault</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExecute()}
                      disabled={isStreaming || !promptText.trim()}
                      className={styles.executeBtn}
                    >
                      {isStreaming ? (
                        <>
                          <RefreshCw size={13} className={styles.spinIcon} />
                          <span>Generating...</span>
                        </>
                      ) : (
                        <>
                          <Play size={13} />
                          <span>Run Prompt</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Response / Markdown Output Section */}
          <div className={styles.responseSection}>
            <div className={styles.responseHeader}>
              <div className={styles.responseHeaderLeft}>
                <span className={styles.sectionLabel}>AI Response (Markdown)</span>
                {isStreaming && (
                  <span className={styles.streamingIndicator}>
                    <span className={styles.pulsingDot} />
                    Streaming output...
                  </span>
                )}
              </div>
              <div className={styles.responseHeaderActions}>
                {isStreaming ? (
                  <button
                    type="button"
                    onClick={handleStopStream}
                    className={styles.stopBtn}
                    title="Stop generation"
                  >
                    <Square size={12} />
                    <span>Stop</span>
                  </button>
                ) : response ? (
                  <button
                    type="button"
                    onClick={() => handleExecute()}
                    className={styles.tabToggleBtn}
                    title="Regenerate output"
                  >
                    <RefreshCw size={12} />
                    <span>Regenerate</span>
                  </button>
                ) : null}
              </div>
            </div>

            <div className={styles.responseBox}>
              {error ? (
                <div className={styles.errorBox}>
                  <AlertCircle size={16} />
                  <div>
                    <strong style={{ display: 'block', marginBottom: 2 }}>Error generating response</strong>
                    <span>{error}</span>
                  </div>
                </div>
              ) : response ? (
                <MarkdownViewer content={response} />
              ) : isStreaming ? (
                <div className={styles.streamingPlaceholder}>
                  <span className={styles.pulsingDot} />
                  <span>Generating response...</span>
                </div>
              ) : (
                <div className={styles.emptyResponsePlaceholder}>
                  <p>Click <strong>Run Prompt</strong> to generate AI output.</p>
                </div>
              )}
              <div ref={responseEndRef} />
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className={styles.footer}>
          <div className={styles.footerLeft}>
            {response && (
              <span className={styles.charCount}>
                {response.length} characters generated
              </span>
            )}
          </div>

          <div className={styles.footerRight}>
            <button
              type="button"
              onClick={handleCopyResponse}
              disabled={!response}
              className={styles.footerBtn}
              title="Copy markdown response to clipboard"
            >
              {copied ? <Check size={14} className={styles.greenText} /> : <Copy size={14} />}
              <span>{copied ? 'Copied' : 'Copy Output'}</span>
            </button>

            {onSendToChat && (
              <button
                type="button"
                onClick={handleSendToChat}
                disabled={!response}
                className={styles.footerBtn}
                title="Send conversation to Space AI Chat"
              >
                <MessageSquare size={14} />
                <span>Send to Chat</span>
              </button>
            )}

            {onInjectToTerminal && (
              <button
                type="button"
                onClick={handleInjectTerminal}
                disabled={!response}
                className={styles.primaryFooterBtn}
                title="Paste / send output into the active terminal session"
              >
                <Terminal size={14} />
                <span>Inject to Terminal</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Animations & Styles ────────────────────────────────────────────────────────

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const slideUp = keyframes`
  from { transform: translateY(12px) scale(0.98); opacity: 0; }
  to { transform: translateY(0) scale(1); opacity: 1; }
`;

const pulse = keyframes`
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.85); }
`;

const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

const styles = {
  overlay: css`
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--spacing-lg, 16px);
    background-color: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    animation: ${fadeIn} 0.2s ease-out;
  `,
  modal: css`
    width: 100%;
    max-width: 48rem;
    max-height: 88vh;
    display: flex;
    flex-direction: column;
    background-color: var(--bg-secondary, #141b26);
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.12));
    border-radius: var(--border-radius-xl, 14px);
    box-shadow: 0 20px 48px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05);
    animation: ${slideUp} 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    overflow: hidden;
  `,
  header: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
    background-color: rgba(255, 255, 255, 0.02);
  `,
  headerTitleRow: css`
    display: flex;
    align-items: center;
    gap: 12px;
  `,
  iconBadge: css`
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: rgba(168, 85, 247, 0.15);
    color: #c084fc;
    border: 1px solid rgba(168, 85, 247, 0.25);
  `,
  title: css`
    font-size: var(--font-size-base, 15px);
    font-weight: 700;
    color: var(--text-primary, #ffffff);
    margin: 0;
  `,
  subtitle: css`
    font-size: 11px;
    color: var(--text-tertiary, #64748b);
    display: block;
    margin-top: 2px;

    code {
      color: var(--color-brand, #3b82f6);
      background: rgba(59, 130, 246, 0.1);
      padding: 1px 4px;
      border-radius: 3px;
      font-family: var(--font-family-mono, monospace);
    }
  `,
  closeBtn: css`
    background: transparent;
    border: none;
    color: var(--text-tertiary, #64748b);
    cursor: pointer;
    padding: 6px;
    border-radius: 6px;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;

    &:hover {
      background-color: var(--bg-hover, rgba(255, 255, 255, 0.08));
      color: var(--text-primary, #ffffff);
    }
  `,
  body: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 18px;
    overflow-y: auto;
    flex: 1;
  `,
  promptSection: css`
    background-color: var(--bg-tertiary, rgba(255, 255, 255, 0.03));
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.08));
    border-radius: 10px;
    overflow: hidden;
  `,
  promptHeader: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background-color: rgba(255, 255, 255, 0.02);
    border-bottom: 1px solid var(--border-color, rgba(255, 255, 255, 0.06));
    cursor: pointer;
    user-select: none;
  `,
  promptHeaderLeft: css`
    display: flex;
    align-items: center;
    gap: 8px;
  `,
  sectionLabel: css`
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary, #94a3b8);
  `,
  badgePreview: css`
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 4px;
    background: rgba(59, 130, 246, 0.15);
    color: #60a5fa;
    font-weight: 600;
  `,
  promptHeaderActions: css`
    display: flex;
    align-items: center;
    gap: 6px;
  `,
  tabToggleBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: 4px;
    background: transparent;
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
    color: var(--text-secondary, #94a3b8);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      background: rgba(255, 255, 255, 0.08);
      color: var(--text-primary, #ffffff);
    }
  `,
  collapseBtn: css`
    background: transparent;
    border: none;
    color: var(--text-tertiary, #64748b);
    padding: 2px;
    display: flex;
    align-items: center;
    cursor: pointer;

    &:hover {
      color: var(--text-primary, #ffffff);
    }
  `,
  promptContent: css`
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  `,
  promptInput: css`
    width: 100%;
    box-sizing: border-box;
    background-color: var(--bg-primary, #0d131f);
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
    border-radius: 6px;
    padding: 10px 12px;
    font-family: var(--font-family-mono, monospace);
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-primary, #e2e8f0);
    outline: none;
    resize: vertical;
    min-height: 70px;

    &:focus {
      border-color: var(--color-brand, #3b82f6);
    }
  `,
  promptPreviewBox: css`
    background-color: var(--bg-primary, #0d131f);
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
    border-radius: 6px;
    padding: 10px 12px;
    max-height: 160px;
    overflow-y: auto;
  `,
  promptFooter: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  `,
  varHints: css`
    font-size: 11px;
    color: var(--text-tertiary, #64748b);

    code {
      color: #94a3b8;
      background: rgba(255, 255, 255, 0.05);
      padding: 1px 4px;
      border-radius: 3px;
      font-family: var(--font-family-mono, monospace);
    }
  `,
  promptControls: css`
    display: flex;
    align-items: center;
    gap: 8px;
  `,
  secondaryActionBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    border-radius: 6px;
    background: transparent;
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
    color: var(--text-secondary, #94a3b8);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      background: rgba(255, 255, 255, 0.06);
      color: var(--text-primary, #ffffff);
    }
  `,
  executeBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    border-radius: 6px;
    background: var(--gradient-brand, linear-gradient(135deg, #3b82f6, #8b5cf6));
    border: none;
    color: #ffffff;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;

    &:hover:not(:disabled) {
      filter: brightness(1.1);
      transform: translateY(-1px);
    }

    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  `,
  spinIcon: css`
    animation: ${spin} 1s linear infinite;
  `,
  responseSection: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
    min-height: 220px;
  `,
  responseHeader: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  responseHeaderLeft: css`
    display: flex;
    align-items: center;
    gap: 10px;
  `,
  streamingIndicator: css`
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--color-brand, #3b82f6);
    font-weight: 500;
  `,
  pulsingDot: css`
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background-color: var(--color-brand, #3b82f6);
    animation: ${pulse} 1.4s ease-in-out infinite;
  `,
  responseHeaderActions: css`
    display: flex;
    align-items: center;
    gap: 6px;
  `,
  stopBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: 4px;
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #f87171;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      background: rgba(239, 68, 68, 0.25);
    }
  `,
  responseBox: css`
    flex: 1;
    background-color: var(--bg-primary, #0d131f);
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
    border-radius: 10px;
    padding: 14px 16px;
    overflow-y: auto;
    max-height: 380px;
    min-height: 180px;
  `,
  streamingPlaceholder: css`
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-tertiary, #64748b);
    font-size: 12px;
    padding: 12px 0;
  `,
  emptyResponsePlaceholder: css`
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 140px;
    color: var(--text-tertiary, #64748b);
    font-size: 13px;
    text-align: center;
  `,
  errorBox: css`
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px;
    background-color: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.25);
    border-radius: 8px;
    color: #f87171;
    font-size: 12px;
  `,
  footer: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 18px;
    border-top: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
    background-color: rgba(255, 255, 255, 0.02);
    gap: 12px;
    flex-wrap: wrap;
  `,
  footerLeft: css`
    font-size: 11px;
    color: var(--text-tertiary, #64748b);
  `,
  charCount: css`
    color: var(--text-tertiary, #64748b);
  `,
  footerRight: css`
    display: flex;
    align-items: center;
    gap: 8px;
  `,
  footerBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 6px;
    background-color: var(--bg-tertiary, rgba(255, 255, 255, 0.06));
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
    color: var(--text-secondary, #cbd5e1);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover:not(:disabled) {
      background-color: var(--bg-hover, rgba(255, 255, 255, 0.12));
      color: var(--text-primary, #ffffff);
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  `,
  primaryFooterBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border-radius: 6px;
    background: var(--gradient-brand, linear-gradient(135deg, #3b82f6, #8b5cf6));
    border: none;
    color: #ffffff;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;

    &:hover:not(:disabled) {
      filter: brightness(1.1);
      transform: translateY(-1px);
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  `,
  greenText: css`
    color: #4ade80;
  `,
};
