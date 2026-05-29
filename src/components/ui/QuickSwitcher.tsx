import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useDashboard } from '../../context/DashboardContext';
import { Search, CornerDownLeft } from 'lucide-react';
import { css, cx } from '@emotion/css';
import { registerShortcut } from '../../services/keyboardManager';
import { Input } from './Input';

export const QuickSwitcher: React.FC = () => {
  const { workspaces, activeWorkspaceId, setActiveWorkspaceId, setViewMode, showToast } = useDashboard();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  
  const modalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter workspaces based on search query
  const filtered = workspaces.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.description.toLowerCase().includes(search.toLowerCase())
  );

  // Ctrl+K — open/close switcher (skipped when terminal has focus)
  useEffect(() => {
    return registerShortcut({
      key: 'k', ctrl: true,
      context: 'non-terminal',
      handler: () => {
        setIsOpen(prev => !prev);
        setSearch('');
        setSelectedIndex(0);
      },
    });
  }, []);

  // Autofocus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Modal navigation — active only while open (global: modal is above terminal)
  useEffect(() => {
    if (!isOpen) return;
    const removeEsc   = registerShortcut({ key: 'Escape',    context: 'global', handler: () => setIsOpen(false) });
    const removeDown  = registerShortcut({ key: 'ArrowDown', context: 'global', handler: () => setSelectedIndex(prev => (prev + 1) % Math.max(1, filtered.length)) });
    const removeUp    = registerShortcut({ key: 'ArrowUp',   context: 'global', handler: () => setSelectedIndex(prev => (prev - 1 + filtered.length) % Math.max(1, filtered.length)) });
    const removeEnter = registerShortcut({ key: 'Enter',     context: 'global', handler: () => { if (filtered[selectedIndex]) handleSelect(filtered[selectedIndex].id); } });
    return () => { removeEsc(); removeDown(); removeUp(); removeEnter(); };
  }, [isOpen, filtered, selectedIndex]);

  const handleSelect = (id: string) => {
    setActiveWorkspaceId(id);
    setViewMode('grid');
    navigate('/');
    const proj = workspaces.find(p => p.id === id);
    if (proj) showToast(`Switched active workspace to ${proj.name}`, 'success');
    setIsOpen(false);
    setSearch('');
  };

  // Close on outside click
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
      setIsOpen(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      onClick={handleOverlayClick}
      className={styles.overlay}
    >
      <div
        ref={modalRef}
        className={styles.modal}
      >
        {/* Search Input Bar */}
        <div className={styles.searchBar}>
          <Search className={styles.searchIcon} />
          <Input
            ref={inputRef}
            type="text"
            placeholder="Search workspaces... (Arrow keys to navigate, Enter to switch)"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedIndex(0);
            }}
            className={styles.searchInput}
          />
          <kbd className={styles.escKey}>
             ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className={styles.resultsList}>
          {filtered.length > 0 ? (
            filtered.map((proj, idx) => {
              const isSelected = idx === selectedIndex;
              const isActive = proj.id === activeWorkspaceId;

              return (
                <div
                  key={proj.id}
                  onClick={() => handleSelect(proj.id)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={cx(
                    styles.item,
                    isSelected ? styles.itemSelected : styles.itemUnselected
                  )}
                >
                  <div className={styles.itemLeft}>
                    <div
                      className={styles.itemDot}
                      style={{ backgroundColor: proj.color || '#3b82f6' }}
                    />
                    <div className={styles.itemMeta}>
                      <div className={styles.itemNameRow}>
                        <span
                          className={cx(
                            styles.itemName,
                            isSelected ? styles.itemNameSelected : styles.itemNameUnselected
                          )}
                        >
                          {proj.name}
                        </span>
                        {isActive && (
                          <span
                            className={cx(
                              styles.badge,
                              isSelected ? styles.badgeSelected : styles.badgeUnselected
                            )}
                          >
                            Active
                          </span>
                        )}
                      </div>
                      <p
                        className={cx(
                          styles.description,
                          isSelected ? styles.descriptionSelected : styles.descriptionUnselected
                        )}
                      >
                        {proj.description || 'No description'}
                      </p>
                    </div>
                  </div>
                  
                  {isSelected && (
                    <div className={styles.selectAction}>
                      <span>Select</span>
                      <CornerDownLeft className={styles.selectIcon} />
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className={styles.emptyState}>
              No workspaces match "{search}"
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <span>Use Arrow Keys to select and Enter to switch active workspace</span>
          <span>{filtered.length} found</span>
        </div>
      </div>
    </div>
  );
};

const styles = {
  overlay: css`
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 1050;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 15vh;
    padding-left: var(--spacing-md);
    padding-right: var(--spacing-md);
    background-color: rgba(2, 6, 23, 0.85);
    backdrop-filter: blur(4px);
    animation: fadeIn 0.2s ease-out forwards;

    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }
  `,
  modal: css`
    width: 100%;
    max-width: 512px;
    border-radius: var(--border-radius-lg);
    background-color: var(--bg-secondary);
    border: 1px solid var(--border-color);
    box-shadow: var(--shadow-lg), 0 0 15px -3px rgba(var(--color-primary-rgb), 0.25);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    animation: slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;

    @keyframes slideUp {
      from {
        transform: translateY(16px) scale(0.98);
        opacity: 0;
      }
      to {
        transform: translateY(0) scale(1);
        opacity: 1;
      }
    }
  `,
  searchBar: css`
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border-color);
  `,
  searchIcon: css`
    width: 20px;
    height: 20px;
    color: var(--text-tertiary);
    flex-shrink: 0;
  `,
  searchInput: css`
    flex: 1;
    background: transparent;
    border: none;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    outline: none;

    &::placeholder {
      color: var(--text-tertiary);
    }
  `,
  escKey: css`
    padding: 2px 6px;
    border-radius: var(--border-radius-sm);
    background-color: var(--bg-tertiary);
    font-size: 10px;
    font-family: var(--font-family-mono);
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
  `,
  resultsList: css`
    max-height: 300px;
    overflow-y: auto;
    padding: var(--spacing-sm);
    display: flex;
    flex-direction: column;
    gap: 4px;
  `,
  item: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-radius: var(--border-radius-md);
    cursor: pointer;
    transition: background-color 150ms ease, color 150ms ease;
  `,
  itemSelected: css`
    background-color: var(--color-primary);
    color: var(--text-inverse);
  `,
  itemUnselected: css`
    color: var(--text-secondary);

    &:hover {
      background-color: var(--bg-hover);
      color: var(--text-primary);
    }
  `,
  itemLeft: css`
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  `,
  itemDot: css`
    width: 10px;
    height: 10px;
    border-radius: var(--border-radius-full);
    flex-shrink: 0;
  `,
  itemMeta: css`
    min-width: 0;
  `,
  itemNameRow: css`
    display: flex;
    align-items: center;
    gap: 8px;
  `,
  itemName: css`
    font-weight: var(--font-weight-semibold);
    font-size: var(--font-size-sm);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `,
  itemNameSelected: css`
    color: var(--text-inverse);
  `,
  itemNameUnselected: css`
    color: var(--text-primary);
  `,
  badge: css`
    font-size: 10px;
    padding: 2px 6px;
    border-radius: var(--border-radius-sm);
    font-weight: var(--font-weight-semibold);
  `,
  badgeSelected: css`
    background-color: rgba(255, 255, 255, 0.25);
    color: #ffffff;

    [data-theme="dark"] & {
      background-color: rgba(0, 0, 0, 0.2);
      color: var(--text-inverse);
    }
  `,
  badgeUnselected: css`
    background-color: rgba(var(--color-primary-rgb), 0.15);
    color: var(--color-primary);
  `,
  description: css`
    font-size: var(--font-size-xs);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 2px;
  `,
  descriptionSelected: css`
    color: rgba(255, 255, 255, 0.85);

    [data-theme="dark"] & {
      color: rgba(0, 0, 0, 0.7);
    }
  `,
  descriptionUnselected: css`
    color: var(--text-tertiary);
  `,
  selectAction: css`
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    opacity: 0.8;
    font-family: var(--font-family-mono);
  `,
  selectIcon: css`
    width: 12px;
    height: 12px;
  `,
  emptyState: css`
    padding: 32px 0;
    text-align: center;
    font-size: var(--font-size-sm);
    color: var(--text-tertiary);
  `,
  footer: css`
    padding: 8px 16px;
    background-color: var(--bg-tertiary);
    border-top: 1px solid var(--border-color);
    font-size: 10px;
    color: var(--text-tertiary);
    display: flex;
    justify-content: space-between;
    align-items: center;
  `,
};
