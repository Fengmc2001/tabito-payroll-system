'use client';

import {useEffect, useRef, useState} from 'react';

const HOURS = Array.from({length: 25}, (_, hour) => String(hour).padStart(2, '0'));
const MINUTES = Array.from({length: 12}, (_, minute) => String(minute * 5).padStart(2, '0'));

export function TimeInput({value, onChange, label, required = false, allowEndOfDay = false}: {
  value: string; onChange: (value: string) => void; label: string; required?: boolean; allowEndOfDay?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('12:00');
  const root = useRef<HTMLDivElement>(null);
  const hour = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    hour.current?.focus();
    const close = (event: PointerEvent) => {if (!root.current?.contains(event.target as Node)) setOpen(false);};
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const [hours, minutes] = draft.split(':');
  const minuteOptions = hours === '24' ? ['00'] : [...new Set([...MINUTES, minutes])].sort();
  return <div className="time-input" ref={root} data-modal-escape-layer={open ? 'true' : undefined} onKeyDown={event => {
    if (open && event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();}
  }}>
    <button ref={trigger} type="button" className="time-input__trigger" aria-label={label} aria-expanded={open}
      onClick={() => {setDraft(value || '12:00'); setOpen(!open);}}>{value || '选择时间'}</button>
    <input className="time-input__validation" tabIndex={-1} aria-label={`${label}数值`} required={required} value={value} onChange={() => {}}
      onInvalid={event => {event.preventDefault(); setDraft(value || '12:00'); setOpen(true);}} />
    {open && <div className="time-input__popover" role="group" aria-label={`${label}选择`}>
      <p className="time-input__label">{label}</p>
      <div className="time-input__parts">
        <select ref={hour} aria-label={`${label}小时`} value={hours} onChange={e => setDraft(`${e.target.value}:${e.target.value === '24' ? '00' : minutes}`)}>{(allowEndOfDay ? HOURS : HOURS.slice(0, -1)).map(item => <option key={item}>{item}</option>)}</select>
        <span>:</span>
        <select aria-label={`${label}分钟`} value={minutes} onChange={e => setDraft(`${hours}:${e.target.value}`)}>{minuteOptions.map(item => <option key={item}>{item}</option>)}</select>
      </div>
      <button type="button" className="primary-button" onClick={() => {onChange(draft); setOpen(false); trigger.current?.focus();}}>确定</button>
    </div>}
  </div>;
}
