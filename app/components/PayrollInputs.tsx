'use client';

import { InputHTMLAttributes, useEffect, useRef, useState } from 'react';
import { SalaryRecord } from '../lib/payroll';
import { apiRequest } from '../lib/api-client';
import { Field } from './form-controls';

// Keep the editing text separate from the numeric value used for calculation.
export function NumberInput({ value, onChange, max = 10000000, placeholder = '0', ...props }:
  Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'max'> & {
    value: number; onChange: (value: number) => void; max?: number;
  }) {
  const [text, setText] = useState(value === 0 ? '' : String(value));
  const emitted = useRef(value);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (value !== emitted.current) { emitted.current = value; setText(value === 0 ? '' : String(value)); }
  }, [value]);
  useEffect(() => {
    input.current?.setCustomValidity(text && (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)))
      ? '请输入非负整数。' : Number(text) > max ? `不能超过 ${max}。` : '');
  }, [text, max]);
  return <input {...props} ref={input} type="text" inputMode="numeric" pattern="[0-9]*" placeholder={placeholder}
    value={text} onChange={(event) => {
      const next = event.target.value; setText(next);
      const number = /^\d+$/.test(next) && Number.isSafeInteger(Number(next)) ? Number(next) : 0;
      emitted.current = number; onChange(number);
    }} onBlur={() => { if (/^\d+$/.test(text) && Number.isSafeInteger(Number(text))) setText(String(Number(text))); }} />;
}

type Travel = Pick<SalaryRecord, 'travelStart' | 'travelEnd' | 'travelFee'>;
export function TravelFields({ record, onChange, batch = false }: {
  record: SalaryRecord; onChange: (value: Travel & { includeTravel: boolean }) => void; batch?: boolean;
}) {
  const [previous, setPrevious] = useState<Travel | null>(null);
  const [warning, setWarning] = useState('');
  const [loading, setLoading] = useState(true);
  const remembered = useRef<Travel | null>(null);
  const included = record.includeTravel ?? (record.travelFee > 0);
  useEffect(() => {
    let active = true;
    void apiRequest<{ travel: Travel | null }>(`/api/salary-records/travel-defaults?userId=${encodeURIComponent(record.userId)}&currency=${record.currency}`)
      .then((result) => { if (active) setPrevious(result.travel); })
      .catch(() => { if (active) setWarning('暂时无法读取上次交通信息，可以手动填写。'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [record.userId, record.currency]);
  const edit = (values: Partial<Travel>) => onChange({ travelStart: record.travelStart, travelEnd: record.travelEnd, travelFee: record.travelFee, includeTravel: true, ...values });
  return <div className="travel-fields">
    <label className="access-check"><input type="checkbox" checked={included} disabled={loading} aria-busy={loading} onChange={(event) => {
      if (event.target.checked) onChange({ ...(remembered.current ?? previous ?? {travelStart: '', travelEnd: '', travelFee: 0}), includeTravel: true });
      else {
        remembered.current = {travelStart: record.travelStart, travelEnd: record.travelEnd, travelFee: record.travelFee};
        onChange({travelStart: '-', travelEnd: '-', travelFee: 0, includeTravel: false});
      }
    }} />包含交通费{batch ? '（每条）' : ''}</label>
    <div className="form-grid form-grid--three">
      <Field label="交通起点"><input disabled={!included} maxLength={300} value={included ? record.travelStart : ''} placeholder={previous?.travelStart || '-'} onChange={(e) => edit({travelStart: e.target.value})} /></Field>
      <Field label="交通终点"><input disabled={!included} maxLength={300} value={included ? record.travelEnd : ''} placeholder={previous?.travelEnd || '-'} onChange={(e) => edit({travelEnd: e.target.value})} /></Field>
      <Field label={batch ? '每条交通费（往返）' : '交通费（往返）'}><NumberInput disabled={!included} value={included ? record.travelFee : 0} placeholder={included ? '0' : String(previous?.travelFee ?? 0)} onChange={(travelFee) => edit({travelFee})} /></Field>
    </div>
    {warning && <p className="muted-text">{warning}</p>}
  </div>;
}
