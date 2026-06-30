import { useState, useEffect } from 'react';
import { css, cx } from '@emotion/css';
import { motion, AnimatePresence } from 'motion/react';
import {
  HelpCircle, X, Search, Keyboard, Terminal, Layers, MessageSquare, Settings
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
}

interface Section {
  id: string;
  title: string;
  icon: LucideIcon;
  shortcuts?: Shortcut[];
  items?: string[];
  description?: string;
}

const SECTIONS: Section[] = [
  {
    id: 'shortcuts',
    title: 'Keyboard Shortcuts',
    icon: Keyboard,
    shortcuts: [
      { key: 'Ctrl+K / Cmd+K', description: 'Open Quick Switcher' },
      { key: 'Ctrl+H / Cmd+H', description: 'Open this Help' },
      { key: 'Ctrl+F / Cmd+F', description: 'Search in terminal' },
      { key: 'Ctrl+Shift+C', description: 'Copy selection' },
      { key: 'Ctrl+Shift+V', description: 'Paste' },
      { key: 'Escape', description: 'Close modal / search' },
      { key: 'Right Click', description: 'Context menu' },
    ],
  },
  {
    id: 'terminal',
    title: 'Terminal Features',
    icon: Terminal,
    items: [
      'Multiple terminals with tabs',
      'Split view (horizontal/vertical)',
      'Auto-detects shells (zsh, bash, fish, PowerShell, WSL)',
      'GPU-accelerated rendering (WebGL)',
      'Clickable links',
      'Search through output',
      'Custom themes (7+ color schemes)',
      'Visual bell indicator',
      'Context menu (copy/paste/clear)',
    ],
  },
  {
    id: 'workspaces',
    title: 'Workspaces',
    icon: Layers,
    description: 'Organize terminals with AI chat integration',
    items: [
      'Each workspace has its own directory',
      'Multiple terminals per workspace',
      'Integrated AI assistant',
      'Sessions auto-save',
    ],
  },
  {
    id: 'ai',
    title: 'AI Assistant',
    icon: MessageSquare,
    description: 'Automate terminal tasks with natural language',
    items: [
      'Describe tasks, AI generates commands',
      'Code understanding and explanation',
      'Automated terminal task execution',
    ],
  },
  {
    id: 'settings',
    title: 'Settings',
    icon: Settings,
    description: 'Customize appearance and terminal behavior',
    items: [
      'Light/Dark theme',
      'Terminal themes and fonts',
      'Shell selection',
      'Custom keybindings',
    ],
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
        const titleMatch = section.title.toLowerCase().includes(searchQuery.toLowerCase());
        const shortcutMatch = section.shortcuts?.some(s =>
          s.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.description.toLowerCase().includes(searchQuery.toLowerCase())
        );
        const itemMatch = section.items?.some(i =>
          i.toLowerCase().includes(searchQuery.toLowerCase())
        );
        const descMatch = section.description?.toLowerCase().includes(searchQuery.toLowerCase());
        return titleMatch || shortcutMatch || itemMatch || descMatch;
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
                <HelpCircle size={20} />
                <span>Keyboard Shortcuts & Help</span>
              </div>
              <button onClick={onClose} className={s.iconBtn}>
                <X size={18} />
              </button>
            </div>

            {/* Search */}
            <div className={s.searchBar}>
              <Search size={18} className={s.searchIcon} />
              <Input
                type="text"
                placeholder="Search shortcuts..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className={s.searchInput}
                autoFocus
              />
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

              {/* Main */}
              <div className={s.main}>
                <div className={s.sectionHeader}>
                  <Icon size={24} />
                  <h2>{activeSectionData.title}</h2>
                </div>

                {activeSectionData.description && (
                  <p className={s.sectionDesc}>{activeSectionData.description}</p>
                )}

                {activeSectionData.shortcuts && (
                  <div className={s.shortcutsList}>
                    {activeSectionData.shortcuts.map((shortcut, idx) => (
                      <div key={idx} className={s.shortcutRow}>
                        <span className={s.shortcutKeys}>{shortcut.key}</span>
                        <span className={s.shortcutDesc}>{shortcut.description}</span>
                      </div>
                    ))}
                  </div>
                )}

                {activeSectionData.items && (
                  <ul className={s.featureList}>
                    {activeSectionData.items.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                )}

                {searchQuery && filteredSections.length === 0 && (
                  <div className={s.noResults}>
                    <Search size={32} />
                    <p>No results for "{searchQuery}"</p>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className={s.footer}>
              <span className={s.footerHint}>
                Press <kbd>Escape</kbd> to close
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
    max-width: 800px;
    max-height: 85vh;
    border-radius: var(--border-radius-lg);
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    box-shadow: var(--shadow-lg), 0 0 15px -3px rgba(var(--color-primary-rgb), 0.25);
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
  `,
  headerLeft: css`
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
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
    padding: 14px 20px;
    border-bottom: 1px solid var(--border-color);
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
    font-size: var(--font-size-sm);
    color: var(--text-primary);

    &::placeholder {
      color: var(--text-tertiary);
    }
  `,
  content: css`
    flex: 1;
    display: flex;
    overflow: hidden;
  `,
  sidebar: css`
    width: 180px;
    padding: 12px 8px;
    border-right: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    gap: 2px;
  `,
  navItem: css`
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: var(--border-radius-md);
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    cursor: pointer;
    transition: all 150ms;
    text-align: left;

    &:hover:not(:disabled) {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
  `,
  navItemActive: css`
    background: rgba(var(--color-primary-rgb), 0.15);
    color: var(--color-primary);
  `,
  navItemDimmed: css`
    opacity: 0.4;
    cursor: not-allowed;
  `,
  main: css`
    flex: 1;
    padding: 24px;
    overflow-y: auto;

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
    gap: 12px;
    margin-bottom: 8px;
    color: var(--color-primary);

    h2 {
      font-size: 18px;
      font-weight: 600;
      color: var(--text-primary);
      margin: 0;
    }
  `,
  sectionDesc: css`
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    margin: 0 0 20px 0;
    line-height: 1.5;
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
    padding: 12px 16px;
    background: var(--bg-tertiary);
    border-radius: var(--border-radius-md);
    border: 1px solid var(--border-color);
  `,
  shortcutKeys: css`
    padding: 4px 10px;
    background: rgba(var(--color-primary-rgb), 0.15);
    border: 1px solid rgba(var(--color-primary-rgb), 0.3);
    border-radius: var(--border-radius-sm);
    font-family: var(--font-family-mono);
    font-size: var(--font-size-xs);
    font-weight: 500;
    color: var(--color-primary);
  `,
  shortcutDesc: css`
    font-size: var(--font-size-sm);
    color: var(--text-primary);
  `,
  featureList: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;

    li {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 12px;
      background: var(--bg-tertiary);
      border-radius: var(--border-radius-md);

      &::before {
        content: '✓';
        color: var(--color-primary);
        font-weight: 600;
        flex-shrink: 0;
      }
    }
  `,
  noResults: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 48px;
    color: var(--text-tertiary);

    p {
      margin: 0;
      font-size: var(--font-size-sm);
    }
  `,
  footer: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    background: var(--bg-tertiary);
    border-top: 1px solid var(--border-color);
  `,
  footerHint: css`
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);

    kbd {
      padding: 2px 6px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--border-radius-sm);
      font-family: var(--font-family-mono);
    }
  `,
  footerVersion: css`
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  `,
};
