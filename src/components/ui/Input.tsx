import React, { useState, forwardRef } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { css, cx } from '@emotion/css';

const inputBaseStyle = css`
  &:focus-visible { outline: none; }
`;

const revealWrapperStyle = css`
  position: relative;
  display: flex;
  align-items: center;
`;

const revealButtonStyle = css`
  position: absolute;
  right: 0.5rem;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  display: flex;
  color: inherit;
  opacity: 0.5;
  &:hover { opacity: 0.8; }
`;

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  wrapperClassName?: string;
  wrapperStyle?: React.CSSProperties;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ type, className, style, wrapperClassName, wrapperStyle, ...props }, ref) => {
    const [showPassword, setShowPassword] = useState(false);

    if (type === 'password') {
      return (
        <div className={cx(revealWrapperStyle, wrapperClassName)} style={wrapperStyle}>
          <input
            ref={ref}
            type={showPassword ? 'text' : 'password'}
            className={cx(inputBaseStyle, className)}
            style={{ paddingRight: '2rem', ...style }}
            {...props}
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPassword(v => !v)}
            className={revealButtonStyle}
          >
            {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      );
    }

    return (
      <input
        ref={ref}
        type={type}
        className={cx(inputBaseStyle, className)}
        style={style}
        {...props}
      />
    );
  },
);

Input.displayName = 'Input';
