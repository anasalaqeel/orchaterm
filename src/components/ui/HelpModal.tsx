import React, { useState, useEffect } from 'react';
import { css, cx } from '@emotion/css';
import { motion, AnimatePresence } from 'motion/react';
import {
  HelpCircle,
  X,
  Search,
  Keyboard,
  Terminal,
  MessageSquare,
  Settings,
  Sparkles,
  Lightbulb,
  BookOpen,
  Code2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Input } from './Input';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Shortcut {
  key: string;
  description: string;
  category?: string;
}

interface WorkflowGuide {
  title: string;
  badge?: string;
  steps: string[];
}

interface Section {
  id: string;
  title: string;
  icon: LucideIcon;
  description: string;
  shortcuts?: Shortcut[];
  guides?: WorkflowGuide[];
  variables?: { tag: string; description: string }[];
  proTip?: string;
}

const SECTIONS: Section[] = [
  {
    id: 'shortcuts',
    title: 'Keyboard Shortcuts',
    icon: Keyboard,
    description: 'Essential keyboard shortcuts to navigate and control Orchaterm efficiently',
    shortcuts: [
      { key: 'Ctrl+K / Cmd+K', description: 'Open Quick Switcher to jump between workspaces & pages', category: 'Global' },
      { key: 'Ctrl+H / Cmd+H', description: 'Open this interactive User Guide & Shortcuts modal', category: 'Global' },
      { key: 'Ctrl+F / Cmd+F', description: 'Search text inside active terminal output', category: 'Terminal' },
      { key: 'Ctrl+Shift+C', description: 'Copy selected text from terminal', category: 'Terminal' },
      { key: 'Ctrl+Shift+V', description: 'Paste clipboard content into active terminal', category: 'Terminal' },
      { key: 'Ctrl+Enter', description: 'Submit prompt or send message in AI Chat / Manual Override', category: 'Chat & AI' },
      { key: 'Click Quick Action', description: 'Execute CLI command or open AI Prompt Drawer', category: 'Terminal' },
      { key: 'P / R / S', description: 'Pause, Resume, or Stop running Conductor pipeline', category: 'Conductor' },
      { key: 'Escape', description: 'Close modal, AI Prompt drawer, or search overlay', category: 'Global' },
      { key: 'Right Click', description: 'Open terminal context menu (copy, paste, clear buffer)', category: 'Terminal' },
    ],
  },
  {
    id: 'quick_actions',
    title: 'Quick Actions & AI Prompts',
    icon: Sparkles,
    description: 'The floating toolbar at the bottom of each terminal gives you 1-click access to shell scripts and AI prompt workflows.',
    guides: [
      {
        title: 'Running a Shell Command',
        badge: 'CLI Action',
        steps: [
          'Open any terminal tab and locate the floating Quick Actions bar at the bottom.',
          'Click any CLI action pill (e.g. "Status" or "Dev").',
          'The command is immediately typed or auto-executed into your active shell PTY.',
        ],
      },
      {
        title: 'Running an AI Prompt with Terminal Context',
        badge: 'AI Prompt',
        steps: [
          '(Optional) Highlight any code, error stack trace, or log line in the terminal window to populate {{selection}}.',
          'Click an AI Prompt button (e.g. "✨ Explain Error" or "✨ Review Selection"). The interactive AI Drawer slides open with context populated.',
          'Click "Run Prompt" (or let it auto-run). The AI streams back real-time Markdown output with syntax-highlighted code blocks.',
          'Click "Inject to Terminal" to paste the fix directly into your shell, "Send to AI Chat" to forward to Space Chat, or "Copy" code blocks with one click.',
        ],
      },
      {
        title: 'Creating a Custom Quick Action',
        badge: 'Customization',
        steps: [
          'Go to Settings → Terminal & Quick Actions.',
          'Choose Action Type ("Shell Command" or "✨ AI Prompt"), pick a Lucide icon, and select an output target (Modal, Terminal, or Chat).',
          'Write your Markdown prompt template and click context variable chips (e.g. {{selection}}, {{terminal_output}}) to insert dynamic data.',
          'Click "+ Add Quick Action" to save. It immediately appears on all your terminal tabs.',
        ],
      },
    ],
    variables: [
      { tag: '{{selection}}', description: 'Text currently highlighted/selected inside the terminal canvas' },
      { tag: '{{terminal_output}}', description: 'Recent output buffer from the active terminal (~60 lines)' },
      { tag: '{{workspace_name}}', description: 'Active project workspace folder name' },
      { tag: '{{workspace_path}}', description: 'Absolute filesystem directory path of the project' },
      { tag: '{{space_name}}', description: 'Active Agent Space / Team name' },
    ],
    proTip: 'Highlight any specific error trace or snippet in the terminal before clicking "Explain Error" so the AI focuses exactly on what went wrong!',
  },
  {
    id: 'prompts',
    title: 'Prompt Vault & Templates',
    icon: BookOpen,
    description: 'Store, organize, and reuse developer instructions, coding guidelines, and prompt templates.',
    guides: [
      {
        title: 'Finding & Using Saved Prompts',
        badge: 'Library',
        steps: [
          'Open Prompt Vault from the sidebar navigation.',
          'Click tag filter pills or type into the search bar for multi-term AND-search across titles, tags, and content.',
          'Click any prompt card to expand it. Toggle between Markdown Preview (rendered headings, code blocks, lists) and Raw Text to read or copy.',
        ],
      },
      {
        title: 'Pinning Prompts as Terminal Quick Actions',
        badge: 'Workflow',
        steps: [
          'In the Prompt Vault, find any prompt template you use frequently.',
          'Click the "Pin to Actions" button on the prompt card.',
          'The prompt is instantly converted into a 1-click Quick Action button displayed on all your terminal tabs!',
        ],
      },
      {
        title: 'Authoring a New Prompt Template',
        badge: 'Authoring',
        steps: [
          'Click "+ Add Prompt" at the top of the Prompt Vault page.',
          'Fill in the title, tags, and choose workspace scope (or Global for all projects).',
          'Write your template in Markdown. Switch to the "Preview" tab to verify formatting and variable placeholders before saving.',
        ],
      },
    ],
    proTip: 'Use {{selection}} and {{terminal_output}} in your vault templates so they automatically pull live terminal context when pinned as Quick Actions.',
  },
  {
    id: 'terminal',
    title: 'Terminal & Workspaces',
    icon: Terminal,
    description: 'Real GPU-accelerated PTY terminals with multi-tab management, spaces, and search.',
    guides: [
      {
        title: 'Launching & Managing Terminals',
        badge: 'PTY Sessions',
        steps: [
          'Click a workspace in the sidebar to open its terminal console.',
          'Click "+ New Tab" or use the dropdown to choose between PowerShell, Bash, WSL, or zsh.',
          'Double-click a tab header to rename it (e.g. "claude-frontend", "test-runner").',
        ],
      },
      {
        title: 'Grouping Terminals into Agent Spaces',
        badge: 'Spaces',
        steps: [
          'Click the Space selector at the top-left of the console header.',
          'Create or switch to a dedicated Space (e.g. "Frontend Team", "Backend Team").',
          'Terminals, chat feeds, and conductor plans in that space remain logically grouped together.',
        ],
      },
      {
        title: 'Searching & Context Menu',
        badge: 'Navigation',
        steps: [
          'Press Ctrl+F inside any terminal tab to search past command output.',
          'Right-click inside the terminal canvas to open the context menu for quick copy, paste, or buffer clearing.',
        ],
      },
    ],
    proTip: 'Terminal processes continue running seamlessly in the background when switching between Workspace, Chat, and Conductor tabs.',
  },
  {
    id: 'conductor',
    title: 'Conductor Multi-Agent',
    icon: MessageSquare,
    description: 'Orchestrate complex tasks across multiple AI coding agents with dependency graphs and automated handoffs.',
    guides: [
      {
        title: 'Running a Multi-Agent Pipeline',
        badge: 'Pipeline',
        steps: [
          'Open separate terminal tabs in your workspace and start your agents (e.g. Claude Code in Tab 1, Antigravity in Tab 2).',
          'Open the Conductor tab and click "+" to create a new plan goal.',
          'Add tasks, assign each task to a specific terminal session, and check dependencies ("dependsOn").',
          'Click "Approve & Run". The engine dispatches Wave 1 tasks to their assigned terminals.',
          'When an agent outputs ###ORCHATERM_DONE###, Orchaterm captures the output, generates a handoff brief with the local Relay model, and automatically dispatches the next dependent tasks.',
        ],
      },
      {
        title: 'Generating a Plan with an AI Agent',
        badge: 'AI Planner',
        steps: [
          'In the Conductor Plan Builder, click "Generate Plan with Agent".',
          'Describe your high-level goal and choose which agent session should draft the plan.',
          'The agent generates the structured task list and dependency graph for you to review and approve.',
        ],
      },
      {
        title: 'Intervening with Manual Override',
        badge: 'Override',
        steps: [
          'During a running pipeline, navigate to the Manual Override panel on the right.',
          'Select a session to inject clarification messages, or select a task to Force Done, Fail, or Retry.',
        ],
      },
    ],
    proTip: 'Click the 📖 icon in Conductor to copy or download CLAUDE.md protocol instructions into your project root.',
  },
  {
    id: 'settings',
    title: 'Settings & AI Configuration',
    icon: Settings,
    description: 'Connect LLM providers, set up relay models, and customize terminal behavior.',
    guides: [
      {
        title: 'Connecting Local & Cloud AI Providers',
        badge: 'LLM Setup',
        steps: [
          'Go to Settings → AI Providers.',
          'For local AI (free & private), ensure Ollama is running and click "Check Online".',
          'For cloud AI, enter your OpenAI, Anthropic, or Gemini API keys. Keys are saved locally on your device.',
        ],
      },
      {
        title: 'Choosing Provider Mode',
        badge: 'Routing',
        steps: [
          'Select "Simple Mode" to route all AI features through a single provider/model.',
          'Or select "Advanced Mode" to assign dedicated models per use case (e.g. lightweight model for Relay, large model for Chat & Plan Gen).',
        ],
      },
    ],
    proTip: 'Test provider endpoints anytime with the "Check Online" button in Settings to verify connectivity.',
  },
];

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSection, setActiveSection] = useState('shortcuts');

  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setActiveSection('shortcuts');
    }
  }, [isOpen]);

  // Filter sections based on search
  const filteredSections = searchQuery
    ? SECTIONS.filter(section => {
        const query = searchQuery.toLowerCase();
        const titleMatch = section.title.toLowerCase().includes(query);
        const descMatch = section.description.toLowerCase().includes(query);
        const shortcutMatch = section.shortcuts?.some(s =>
          s.key.toLowerCase().includes(query) || s.description.toLowerCase().includes(query) || s.category?.toLowerCase().includes(query)
        );
        const guideMatch = section.guides?.some(g =>
          g.title.toLowerCase().includes(query) || g.steps.some(step => step.toLowerCase().includes(query))
        );
        const variableMatch = section.variables?.some(v =>
          v.tag.toLowerCase().includes(query) || v.description.toLowerCase().includes(query)
        );
        const tipMatch = section.proTip?.toLowerCase().includes(query);
        return titleMatch || descMatch || shortcutMatch || guideMatch || variableMatch || tipMatch;
      })
    : SECTIONS;

  const activeSectionData = SECTIONS.find(s => s.id === activeSection) || SECTIONS[0];
  const Icon = activeSectionData.icon;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={s.overlay}
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={s.modal}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className={s.header}>
              <div className={s.headerLeft}>
                <HelpCircle size={20} className={s.brandIcon} />
                <span>User Guide & Keyboard Shortcuts</span>
              </div>
              <button onClick={onClose} className={s.iconBtn} title="Close guide">
                <X size={18} />
              </button>
            </div>

            {/* Search */}
            <div className={s.searchBar}>
              <Search size={18} className={s.searchIcon} />
              <Input
                type="text"
                placeholder="Search how-to guides, actions, context variables, or shortcuts..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className={s.searchInput}
                autoFocus
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className={s.clearSearchBtn}
                >
                  Clear
                </button>
              )}
            </div>

            {/* Content */}
            <div className={s.content}>
              {/* Sidebar */}
              <div className={s.sidebar}>
                {SECTIONS.map(section => {
                  const SectionIcon = section.icon;
                  const hasResults = filteredSections.some(s => s.id === section.id);
                  return (
                    <button
                      key={section.id}
                      className={cx(
                        s.navItem,
                        activeSection === section.id && s.navItemActive,
                        !hasResults && s.navItemDimmed
                      )}
                      onClick={() => setActiveSection(section.id)}
                      disabled={!hasResults}
                    >
                      <SectionIcon size={16} />
                      <span>{section.title}</span>
                    </button>
                  );
                })}
              </div>

              {/* Main Guide View */}
              <div className={s.main}>
                <div className={s.sectionHeader}>
                  <Icon size={22} />
                  <h2>{activeSectionData.title}</h2>
                </div>

                {activeSectionData.description && (
                  <p className={s.sectionDesc}>{activeSectionData.description}</p>
                )}

                {/* Keyboard Shortcuts List */}
                {activeSectionData.shortcuts && (
                  <div className={s.shortcutsList}>
                    {activeSectionData.shortcuts.map((shortcut, idx) => (
                      <div key={idx} className={s.shortcutRow}>
                        <div className={s.shortcutLeft}>
                          <span className={s.shortcutKeys}>{shortcut.key}</span>
                          {shortcut.category && (
                            <span className={s.categoryBadge}>{shortcut.category}</span>
                          )}
                        </div>
                        <span className={s.shortcutDesc}>{shortcut.description}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Workflow Guides (Distinct Step-by-Step Cards) */}
                {activeSectionData.guides && (
                  <div className={s.guidesContainer}>
                    {activeSectionData.guides.map((guide, idx) => (
                      <div key={idx} className={s.guideCard}>
                        <div className={s.guideHeader}>
                          <span className={s.guideTitle}>{guide.title}</span>
                          {guide.badge && <span className={s.guideBadge}>{guide.badge}</span>}
                        </div>
                        <div className={s.stepsList}>
                          {guide.steps.map((stepText, stepIdx) => (
                            <div key={stepIdx} className={s.stepRow}>
                              <span className={s.stepNumber}>{stepIdx + 1}</span>
                              <span className={s.stepText}>{stepText}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Context Variables Guide */}
                {activeSectionData.variables && activeSectionData.variables.length > 0 && (
                  <div className={s.variablesContainer}>
                    <h3 className={s.subheading}>
                      <Code2 size={15} />
                      <span>Supported Context Variables in Templates:</span>
                    </h3>
                    <div className={s.variablesGrid}>
                      {activeSectionData.variables.map((v, idx) => (
                        <div key={idx} className={s.variableCard}>
                          <code className={s.variableTag}>{v.tag}</code>
                          <span className={s.variableDesc}>{v.description}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Pro Tip Callout Box */}
                {activeSectionData.proTip && (
                  <div className={s.proTipBox}>
                    <div className={s.proTipHeader}>
                      <Lightbulb size={16} />
                      <span>Pro Tip</span>
                    </div>
                    <p className={s.proTipText}>{activeSectionData.proTip}</p>
                  </div>
                )}

                {/* Empty State */}
                {searchQuery && filteredSections.length === 0 && (
                  <div className={s.noResults}>
                    <Search size={32} />
                    <p>No guides or shortcuts found matching "{searchQuery}"</p>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className={s.footer}>
              <span className={s.footerHint}>
                Press <kbd>Escape</kbd> or click outside to close
              </span>
              <span className={s.footerVersion}>Orchaterm v0.1.0</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const s = {
  overlay: css`
    position: fixed;
    inset: 0;
    z-index: 1050;
    background: rgba(2, 6, 23, 0.85);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--spacing-md);
  `,
  modal: css`
    width: 100%;
    max-width: 860px;
    height: 85vh;
    max-height: 720px;
    border-radius: var(--border-radius-lg);
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    box-shadow: var(--shadow-lg), 0 0 20px -3px rgba(123, 104, 238, 0.25);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  `,
  header: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-tertiary);
  `,
  headerLeft: css`
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 15px;
    font-weight: 700;
    color: var(--text-primary);
  `,
  brandIcon: css`
    color: var(--color-brand, #7b68ee);
  `,
  iconBtn: css`
    width: 32px;
    height: 32px;
    border-radius: var(--border-radius-sm);
    background: transparent;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 150ms;

    &:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
  `,
  searchBar: css`
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 20px;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-secondary);
  `,
  searchIcon: css`
    color: var(--text-tertiary);
    flex-shrink: 0;
  `,
  searchInput: css`
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font-size: 13px;
    color: var(--text-primary);

    &::placeholder {
      color: var(--text-tertiary);
    }
  `,
  clearSearchBtn: css`
    background: none;
    border: none;
    color: var(--text-tertiary);
    font-size: 11px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    &:hover {
      color: var(--text-primary);
      background: var(--bg-hover);
    }
  `,
  content: css`
    flex: 1;
    display: flex;
    overflow: hidden;
  `,
  sidebar: css`
    width: 200px;
    padding: 12px 8px;
    border-right: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    gap: 3px;
    background: rgba(0, 0, 0, 0.15);
    flex-shrink: 0;
  `,
  navItem: css`
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    border-radius: var(--border-radius-md);
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 150ms;
    text-align: left;

    &:hover:not(:disabled) {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
  `,
  navItemActive: css`
    background: rgba(123, 104, 238, 0.15);
    color: var(--color-brand, #7b68ee);
    font-weight: 600;
  `,
  navItemDimmed: css`
    opacity: 0.35;
    cursor: not-allowed;
  `,
  main: css`
    flex: 1;
    padding: 22px 24px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;

    &::-webkit-scrollbar {
      width: 6px;
    }
    &::-webkit-scrollbar-track {
      background: transparent;
    }
    &::-webkit-scrollbar-thumb {
      background: var(--border-color);
      border-radius: 3px;
    }
  `,
  sectionHeader: css`
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--color-brand, #7b68ee);

    h2 {
      font-size: 17px;
      font-weight: 700;
      color: var(--text-primary);
      margin: 0;
    }
  `,
  sectionDesc: css`
    font-size: 13px;
    color: var(--text-secondary);
    margin: 0;
    line-height: 1.5;
  `,
  subheading: css`
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-secondary);
    margin: 0 0 10px 0;
  `,
  shortcutsList: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  shortcutRow: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: var(--bg-tertiary);
    border-radius: var(--border-radius-md);
    border: 1px solid var(--border-color);
    gap: 12px;
  `,
  shortcutLeft: css`
    display: flex;
    align-items: center;
    gap: 8px;
  `,
  shortcutKeys: css`
    padding: 3px 8px;
    background: rgba(123, 104, 238, 0.12);
    border: 1px solid rgba(123, 104, 238, 0.3);
    border-radius: var(--border-radius-sm);
    font-family: var(--font-family-mono);
    font-size: 11px;
    font-weight: 600;
    color: var(--color-brand, #7b68ee);
    white-space: nowrap;
  `,
  categoryBadge: css`
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-tertiary);
    border: 1px solid var(--border-color);
  `,
  shortcutDesc: css`
    font-size: 12px;
    color: var(--text-primary);
    text-align: right;
  `,
  guidesContainer: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
  `,
  guideCard: css`
    padding: 14px 16px;
    background: var(--bg-tertiary);
    border-radius: var(--border-radius-md);
    border: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    gap: 10px;
  `,
  guideHeader: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  guideTitle: css`
    font-size: 13px;
    font-weight: 700;
    color: var(--text-primary);
  `,
  guideBadge: css`
    font-size: 10px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 4px;
    background: rgba(123, 104, 238, 0.15);
    color: var(--color-brand, #7b68ee);
    border: 1px solid rgba(123, 104, 238, 0.3);
  `,
  stepsList: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  stepRow: css`
    display: flex;
    align-items: flex-start;
    gap: 10px;
  `,
  stepNumber: css`
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-primary);
    font-size: 10px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 1px;
  `,
  stepText: css`
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.45;
    flex: 1;
  `,
  variablesContainer: css`
    display: flex;
    flex-direction: column;
    margin-top: 4px;
  `,
  variablesGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 8px;
  `,
  variableCard: css`
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 8px 10px;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
  `,
  variableTag: css`
    font-family: var(--font-family-mono);
    font-size: 11px;
    font-weight: 600;
    color: #c084fc;
  `,
  variableDesc: css`
    font-size: 11px;
    color: var(--text-secondary);
    line-height: 1.3;
  `,
  proTipBox: css`
    padding: 12px 14px;
    background: rgba(245, 158, 11, 0.08);
    border: 1px solid rgba(245, 158, 11, 0.25);
    border-radius: var(--border-radius-md);
    display: flex;
    flex-direction: column;
    gap: 4px;
  `,
  proTipHeader: css`
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 700;
    color: #f59e0b;
  `,
  proTipText: css`
    font-size: 12px;
    color: var(--text-secondary);
    margin: 0;
    line-height: 1.45;
  `,
  noResults: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 40px;
    color: var(--text-tertiary);

    p {
      margin: 0;
      font-size: 13px;
    }
  `,
  footer: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 20px;
    background: var(--bg-tertiary);
    border-top: 1px solid var(--border-color);
  `,
  footerHint: css`
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--text-tertiary);

    kbd {
      padding: 1px 5px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--border-radius-sm);
      font-family: var(--font-family-mono);
      font-size: 10px;
    }
  `,
  footerVersion: css`
    font-size: 11px;
    color: var(--text-tertiary);
  `,
};
