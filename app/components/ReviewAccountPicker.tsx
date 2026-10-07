'use client';

import {useEffect, useId, useRef, useState} from 'react';
import {ChevronDown, Check, Search} from 'lucide-react';
import type {reviewAccountOptions} from '../lib/review-accounts';

export function ReviewAccountPicker({options, value, onChange, disabled, administrator, month}: {
  options: ReturnType<typeof reviewAccountOptions>; value: string; onChange: (id: string) => void;
  disabled: boolean; administrator: boolean; month: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId();
  const active = options.find(option => option.id === value);
  const allLabel = administrator ? '全部账号' : '全部可审核账号';
  const duplicates = new Set(options.filter((option, index) => options.findIndex(other => other.name === option.name) !== index).map(option => option.name));
  const visible = options.filter(option => `${option.name} ${option.email}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const close = (event: PointerEvent) => {if (!root.current?.contains(event.target as Node)) setOpen(false);};
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const choose = (next: string) => {onChange(next); setOpen(false); trigger.current?.focus();};
  const displayed = open && !disabled;
  return <div className="review-account-picker" ref={root} onKeyDown={event => {
    if (displayed && event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();}
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!displayed) return;
      const entries = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
      const index = entries.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'ArrowDown' ? Math.min(entries.length - 1, index + 1) : Math.max(0, index - 1);
      event.preventDefault(); entries[next]?.focus();
    }
  }}>
    <span id={`${id}-label`}>查看账号</span>
    <button ref={trigger} type="button" className={`review-account-trigger${active?.complete ? ' is-complete' : ''}`} disabled={disabled}
      aria-haspopup="listbox" aria-expanded={displayed} aria-controls={`${id}-list`} aria-labelledby={`${id}-label ${id}-selected`}
      onClick={() => {setQuery(''); setOpen(!open);}}><span id={`${id}-selected`}>{active?.name || allLabel}</span><ChevronDown size={15}/></button>
    {displayed && <div className="review-account-menu">
      <p>{month} · 当前可见申报</p>
      <label className="review-account-search"><Search size={15}/><input ref={search} aria-label="搜索员工" placeholder="搜索姓名" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <div id={`${id}-list`} role="listbox" aria-label="选择查看账号">
        <button type="button" role="option" aria-selected={!value} onClick={() => choose('')}><span>{allLabel}</span>{!value && <Check size={15}/>}</button>
        {visible.map(option => <button key={option.id} type="button" role="option" aria-selected={value === option.id} className={option.complete ? 'is-complete' : ''} onClick={() => choose(option.id)}>
          <span className="review-account-name">{option.name}{duplicates.has(option.name) && <small>{option.email}</small>}</span>
          <span className="review-account-state">{option.pending ? `待审核 ${option.pending} 条` : option.complete ? '当月审核完毕' : '本月暂无申报'}</span>
        </button>)}
        {!visible.length && <p className="review-account-empty">未找到员工</p>}
      </div>
    </div>}
  </div>;
}
