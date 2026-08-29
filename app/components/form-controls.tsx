'use client';

import { ChangeEvent, ReactNode, useId, useState } from 'react';

export function Field({
  label,
  required = false,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="form-field">
      <span className="form-field__label">
        {label}
        {required && <b aria-label="必填">*</b>}
      </span>
      {children}
      {hint && <small className="form-field__hint">{hint}</small>}
    </label>
  );
}

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="form-section">
      <div className="form-section__heading">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function FileNameInput({
  value,
  onChange,
  maximum,
  accept = 'image/*,.pdf',
  onUpload,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  maximum: number;
  accept?: string;
  onUpload?: (file: File) => Promise<string>;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changeFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).slice(0, Math.max(0, maximum - value.length));
    event.target.value = '';
    if (files.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const names = onUpload ? await Promise.all(files.map(onUpload)) : files.map((file) => file.name);
      onChange([...value, ...names].slice(0, maximum));
    } catch {
      setError('文件上传失败，请重试。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="file-picker">
      <input id={id} type="file" accept={accept} multiple={maximum > 1} onChange={changeFiles} />
      <label className="secondary-button file-picker__button" htmlFor={id}>{busy ? '上传中…' : '+ Upload'}</label>
      <span className="file-picker__limit">最多 {maximum} 个图片/PDF</span>
      {value.length > 0 && (
        <ul className="file-picker__list">
          {value.map((name, index) => (
            <li key={`${name}-${index}`}>
              <span title={name}>{friendlyFileName(name)}</span>
              <button
                type="button"
                aria-label={`移除 ${name}`}
                onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <small className="file-picker__error">{error}</small>}
    </div>
  );
}

function friendlyFileName(value: string) {
  const last = value.split('/').pop() ?? value;
  return last.replace(/^\d+-file-[a-f0-9]+-/, '');
}

export function StatusMessage({
  message,
  tone = 'success',
}: {
  message: string;
  tone?: 'success' | 'error' | 'info';
}) {
  if (!message) return null;
  return <p className={`status-message status-message--${tone}`} role="status">{message}</p>;
}
