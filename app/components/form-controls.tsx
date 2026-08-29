'use client';

import { ChangeEvent, ReactNode, useEffect, useId, useState } from 'react';

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
    const selectedFiles = Array.from(event.target.files ?? []);
    const remaining = Math.max(0, maximum - value.length);
    event.target.value = '';
    if (selectedFiles.length === 0) return;
    if (remaining === 0) {
      setError(`最多只能上传 ${maximum} 个文件，请先移除已有文件。`);
      return;
    }
    const files = selectedFiles.slice(0, remaining);
    const limitWarning = selectedFiles.length > remaining
      ? `最多只能上传 ${maximum} 个文件，本次仅保留前 ${remaining} 个。`
      : '';
    setBusy(true);
    setError(limitWarning);
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
                onClick={() => {
                  setError('');
                  onChange(value.filter((_, itemIndex) => itemIndex !== index));
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <StatusMessage message={error} tone="error" />
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
  const [popupVisible, setPopupVisible] = useState(Boolean(message));

  useEffect(() => {
    const showTimer = window.setTimeout(() => setPopupVisible(Boolean(message)), 0);
    if (!message) {
      return () => window.clearTimeout(showTimer);
    }
    const hideTimer = window.setTimeout(() => setPopupVisible(false), 6000);
    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
    };
  }, [message, tone]);

  if (!message) return null;
  const title = tone === 'error' ? '操作警示' : tone === 'success' ? '操作成功' : '系统提示';
  const icon = tone === 'error' ? '!' : tone === 'success' ? '✓' : 'i';

  return (
    <>
      <p className={`status-message status-message--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{message}</p>
      {popupVisible && (
        <div
          className={`notification-popup notification-popup--${tone}`}
          role="alertdialog"
          aria-modal="false"
          aria-label={title}
        >
          <span className="notification-popup__icon" aria-hidden="true">{icon}</span>
          <div><strong>{title}</strong><p>{message}</p></div>
          <button type="button" aria-label="关闭提示弹窗" onClick={() => setPopupVisible(false)}>×</button>
        </div>
      )}
    </>
  );
}
