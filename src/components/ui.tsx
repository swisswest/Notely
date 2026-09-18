import type { ButtonHTMLAttributes, InputHTMLAttributes, Ref, ReactNode } from 'react';
import { useEffect, useRef } from 'react';

type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = 'default', className, type, ...rest }: ButtonProps) {
  const variantClass = variant === 'default' ? '' : ` button--${variant}`;
  return (
    <button
      type={type ?? 'button'}
      className={`button${variantClass}${className ? ` ${className}` : ''}`}
      {...rest}
    />
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  children: ReactNode;
}

export function Field({ label, hint, children }: FieldProps) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

/**
 * `ref` steht hier im Props-Typ, weil React 19 Refs an Funktionskomponenten
 * wie jede andere Eigenschaft durchreicht - `forwardRef` braucht es dafuer
 * nicht mehr. Ohne den Eintrag im Typ wuerde TypeScript ihn ablehnen.
 */
type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
  ref?: Ref<HTMLInputElement>;
};

export function TextInput({ className, ...rest }: TextInputProps) {
  return <input className={`input${className ? ` ${className}` : ''}`} {...rest} />;
}

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  ariaLabel?: string;
}

export function Checkbox({ checked, onChange, label, ariaLabel }: CheckboxProps) {
  return (
    <label className="checkbox">
      <input
        type="checkbox"
        checked={checked}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      {label ? <span>{label}</span> : null}
    </label>
  );
}

interface DialogProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function Dialog({ title, subtitle, onClose, children, footer }: DialogProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    containerRef.current?.querySelector<HTMLElement>('input, textarea, button')?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} ref={containerRef}>
        <h2 className="dialog__title">{title}</h2>
        {subtitle ? <p className="dialog__subtitle">{subtitle}</p> : null}
        {children}
        {footer ? <div className="dialog__footer">{footer}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Confidence({ value }: { value: number }) {
  const percent = Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return (
    <span className="confidence" title={`Confidence ${percent}%`}>
      <span className="confidence__bar">
        <span className="confidence__fill" style={{ width: `${percent}%` }} />
      </span>
      {percent}%
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}
