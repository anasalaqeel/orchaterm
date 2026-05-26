import React, { useState, useRef, useEffect } from 'react';
import { css, cx } from '@emotion/css';
import { ChevronDown, Check, Terminal, LucideIcon } from 'lucide-react';

export interface SelectOption {
  value: string;
  name: string;
  description?: string;
  icon?: LucideIcon;
}

interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  error?: string;
}

export const Select: React.FC<SelectProps> = ({
  options,
  value,
  onChange,
  label,
  error,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const selectedOption = options.find((opt) => opt.value === value) ?? options[0];
  const ActiveIcon = selectedOption?.icon ?? Terminal;

  return (
    <div className={styles.container} ref={containerRef}>
      {label && <label className={styles.label}>{label}</label>}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          className={styles.trigger}
          onClick={() => setIsOpen(!isOpen)}
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
          <ChevronDown className={styles.chevron} />
        </button>

        {isOpen && (
          <div className={styles.dropdown}>
            {options.map((opt) => {
              const isActive = opt.value === value;
              const OptIcon = opt.icon ?? Terminal;
              return (
                <button
                  key={opt.value}
                  type="button"
                  className={cx(
                    styles.item,
                    isActive && styles.itemActive
                  )}
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
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
              );
            })}
          </div>
        )}
      </div>
      {error && <p className={styles.errorText}>{error}</p>}
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
  dropdown: css`
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 10;
    margin-top: 4px;
    background-color: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    box-shadow: var(--shadow-md);
    padding: 4px;
    max-height: 200px;
    overflow-y: auto;
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
