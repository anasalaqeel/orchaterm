import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { css, cx } from '@emotion/css';
import { ChevronDown, Check, Terminal, LucideIcon } from 'lucide-react';

export interface SelectOption {
  value: string;
  name: string;
  description?: string;
  icon?: LucideIcon;
  /** Groups options under a header in the dropdown. Consecutive options sharing a group are clustered. */
  group?: string;
  /** Renders the option inert (no hover/click), for placeholders like "no items available". */
  disabled?: boolean;
}

interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  error?: string;
  disabled?: boolean;
  /** Compact mode: tighter padding + smaller font for inline/toolbar use */
  compact?: boolean;
}

interface DropdownPos {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
}

export const Select: React.FC<SelectProps> = ({
  options,
  value,
  onChange,
  label,
  error,
  disabled = false,
  compact = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<DropdownPos | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const calculatePos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const maxDropdownH = 208; // max-height + padding
    const gap = 4;

    const spaceBelow = viewportHeight - rect.bottom - gap;
    const spaceAbove = rect.top - gap;

    if (spaceBelow >= Math.min(maxDropdownH, 80) || spaceBelow >= spaceAbove) {
      // Open downward
      setDropdownPos({
        top: rect.bottom + gap,
        left: rect.left,
        width: rect.width,
      });
    } else {
      // Open upward
      setDropdownPos({
        bottom: viewportHeight - rect.top + gap,
        left: rect.left,
        width: rect.width,
      });
    }
  }, []);

  const openDropdown = useCallback(() => {
    if (disabled) return;
    calculatePos();
    setIsOpen(true);
  }, [disabled, calculatePos]);

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    setDropdownPos(null);
  }, []);

  // Close on click outside (both trigger area and portal dropdown)
  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      // Check trigger container
      if (containerRef.current?.contains(target)) return;
      // Check portal dropdown (by class)
      const portalEl = document.querySelector('[data-select-dropdown]');
      if (portalEl?.contains(target)) return;
      closeDropdown();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen, closeDropdown]);

  // Recalculate on scroll/resize while open
  useEffect(() => {
    if (!isOpen) return;
    const handler = () => calculatePos();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [isOpen, calculatePos]);

  const selectedOption = options.find((opt) => opt.value === value) ?? options[0];
  const ActiveIcon = selectedOption?.icon ?? Terminal;

  const dropdown = isOpen && dropdownPos
    ? ReactDOM.createPortal(
        <div
          data-select-dropdown
          className={styles.dropdown}
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            bottom: dropdownPos.bottom,
            left: dropdownPos.left,
            width: dropdownPos.width,
          }}
        >
          {options.map((opt, i) => {
            const isActive = opt.value === value;
            const OptIcon = opt.icon ?? Terminal;
            const showGroupHeader = opt.group !== undefined && opt.group !== options[i - 1]?.group;
            return (
              <React.Fragment key={opt.value}>
                {showGroupHeader && <div className={styles.groupHeader}>{opt.group}</div>}
                <button
                  type="button"
                  className={cx(styles.item, isActive && styles.itemActive, opt.disabled && styles.itemDisabled)}
                  disabled={opt.disabled}
                  onMouseDown={e => {
                    if (opt.disabled) return;
                    e.preventDefault(); // prevent blur before click
                    onChange(opt.value);
                    closeDropdown();
                  }}
                >
                  <OptIcon className={styles.itemIcon} />
                  <div className={styles.itemText}>
                    <span className={styles.itemName}>{opt.name}</span>
                    {opt.description && (
                      <span className={styles.itemDescription}>{opt.description}</span>
                    )}
                  </div>
                  {isActive && <Check className={styles.itemCheck} />}
                </button>
              </React.Fragment>
            );
          })}
        </div>,
        document.body,
      )
    : null;

  return (
    <div className={styles.container} ref={containerRef}>
      {label && <label className={styles.label}>{label}</label>}
      <button
        ref={triggerRef}
        type="button"
        className={cx(styles.trigger, compact && styles.triggerCompact)}
        onClick={() => (isOpen ? closeDropdown() : openDropdown())}
        disabled={disabled}
      >
        <ActiveIcon className={styles.triggerIcon} />
        <div className={styles.textContainer}>
          <span className={styles.activeName}>
            {selectedOption?.name ?? 'Select option...'}
          </span>
          {selectedOption?.description && (
            <span className={styles.activeDescription}>
              {selectedOption.description}
            </span>
          )}
        </div>
        <ChevronDown className={cx(styles.chevron, isOpen && styles.chevronOpen)} />
      </button>
      {error && <p className={styles.errorText}>{error}</p>}
      {dropdown}
    </div>
  );
};

const styles = {
  container: css`
    display: flex;
    flex-direction: column;
    width: 100%;
  `,
  label: css`
    display: block;
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--text-secondary);
    margin-bottom: var(--spacing-xs);
  `,
  trigger: css`
    display: flex;
    align-items: center;
    width: 100%;
    background-color: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: 8px 12px;
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
    transition: all 0.15s ease-in-out;
    outline: none;

    &:hover {
      border-color: var(--border-color-hover);
      background-color: var(--bg-hover);
    }
    &:focus-visible {
      border-color: var(--color-brand);
      box-shadow: 0 0 0 1px var(--color-brand);
    }
    &:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
  `,
  triggerCompact: css`
    padding: 5px 8px;
    font-size: var(--font-size-xs);
  `,
  triggerIcon: css`
    width: 14px;
    height: 14px;
    color: var(--color-brand);
    margin-right: 10px;
    flex-shrink: 0;
  `,
  textContainer: css`
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  `,
  activeName: css`
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `,
  activeDescription: css`
    font-size: 10px;
    color: var(--text-tertiary);
    font-family: var(--font-family-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 1px;
  `,
  chevron: css`
    width: 14px;
    height: 14px;
    color: var(--text-secondary);
    margin-left: 8px;
    flex-shrink: 0;
    transition: transform 0.15s ease;
  `,
  chevronOpen: css`
    transform: rotate(180deg);
  `,
  dropdown: css`
    z-index: 9999;
    background-color: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    box-shadow: var(--shadow-md);
    padding: 4px;
    max-height: 200px;
    overflow-y: auto;
  `,
  groupHeader: css`
    padding: 8px 10px 4px;
    font-size: 10px;
    font-weight: var(--font-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-tertiary);
    user-select: none;

    &:not(:first-child) {
      margin-top: 4px;
      padding-top: 8px;
      border-top: 1px solid var(--border-color);
    }
  `,
  item: css`
    display: flex;
    align-items: center;
    width: 100%;
    padding: 8px 10px;
    background: transparent;
    border: none;
    border-radius: var(--border-radius-sm);
    cursor: pointer;
    text-align: left;
    transition: all 0.15s ease;
    color: var(--text-secondary);

    &:hover {
      background-color: var(--bg-hover);
      color: var(--text-primary);
    }
  `,
  itemDisabled: css`
    cursor: default;
    opacity: 0.5;
    font-style: italic;

    &:hover {
      background-color: transparent;
      color: var(--text-secondary);
    }
  `,
  itemActive: css`
    background-color: rgba(123, 104, 238, 0.12);
    color: var(--color-brand);
    font-weight: var(--font-weight-semibold);
  `,
  itemIcon: css`
    width: 13px;
    height: 13px;
    color: var(--color-brand);
    margin-right: 8px;
    flex-shrink: 0;
  `,
  itemText: css`
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  `,
  itemName: css`
    font-size: var(--font-size-xs);
    font-weight: inherit;
    line-height: 1.2;
  `,
  itemDescription: css`
    font-size: 10px;
    color: var(--text-tertiary);
    font-family: var(--font-family-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `,
  itemCheck: css`
    width: 12px;
    height: 12px;
    color: var(--color-brand);
    margin-left: 8px;
    flex-shrink: 0;
  `,
  errorText: css`
    font-size: 10px;
    color: var(--color-error);
    margin-top: 4px;
  `,
};
