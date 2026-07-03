import React, { useState, useEffect } from 'react';
import { Input, InputProps } from './Input';

export interface NumberFieldProps extends Omit<InputProps, 'type' | 'value' | 'onChange' | 'min' | 'max' | 'step'> {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

/**
 * Text-based numeric input — not `type="number"`. WebView2 on Windows renders
 * native number inputs using the OS display language's numeral system (e.g.
 * Arabic-Indic digits under an Arabic locale), which silently rejects Western
 * digit keystrokes while leaving the native spinner arrows working. Plain text
 * + manual parsing sidesteps that entirely.
 */
export const NumberField: React.FC<NumberFieldProps> = ({
  value,
  onValueChange,
  min,
  max,
  step = 1,
  ...props
}) => {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const clamp = (n: number) => {
    let v = n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    return v;
  };

  return (
    <Input
      type="text"
      inputMode={step < 1 ? 'decimal' : 'numeric'}
      value={text}
      onChange={e => {
        const raw = e.target.value;
        if (!/^-?\d*\.?\d*$/.test(raw)) return;
        setText(raw);
        if (raw !== '' && raw !== '-' && !raw.endsWith('.')) {
          const n = parseFloat(raw);
          if (!isNaN(n)) onValueChange(clamp(n));
        }
      }}
      onBlur={() => {
        const n = parseFloat(text);
        const v = clamp(isNaN(n) ? value : n);
        onValueChange(v);
        setText(String(v));
      }}
      onKeyDown={e => {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          onValueChange(clamp(value + step));
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          onValueChange(clamp(value - step));
        }
      }}
      {...props}
    />
  );
};
