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
type Subsidies = Travel & { mealFee: number; miscFee: number };
export function TravelFields({ record, onChange, batch = false }: {
  record: SalaryRecord; onChange: (value: Subsidies & { includeTravel: boolean; includeSubsidies: boolean }) => void; batch?: boolean;
}) {
  const [previous, setPrevious] = useState<Omit<Subsidies, 'miscFee'> | null>(null);
  const [warning, setWarning] = useState('');
  const [loading, setLoading] = useState(true);
  const remembered = useRef<Subsidies | null>(null);
  const included = record.includeSubsidies ?? record.includeTravel ?? (record.travelFee > 0 || (record.mealFee ?? 0) > 0 || (record.miscFee ?? 0) > 0);
  useEffect(() => {
    let active = true;
    remembered.current = null;
    void apiRequest<{ subsidies: Omit<Subsidies, 'miscFee'> | null }>(`/api/salary-records/subsidy-defaults?userId=${encodeURIComponent(record.userId)}&currency=${record.currency}`)
      .then((result) => { if (active) setPrevious(result.subsidies); })
      .catch(() => { if (active) setWarning('暂时无法读取上次补贴，可以手动填写。'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [record.userId, record.currency]);
  const current = {travelStart: record.travelStart, travelEnd: record.travelEnd, travelFee: record.travelFee, mealFee: record.mealFee ?? 0, miscFee: record.miscFee ?? 0};
  const edit = (values: Partial<Subsidies>) => onChange({ ...current, includeTravel: true, includeSubsidies: true, ...values });
  return <div className="travel-fields">
    <label className="access-check"><input type="checkbox" checked={included} disabled={loading} aria-busy={loading} onChange={(event) => {
      if (event.target.checked) onChange({ ...(remembered.current ?? {...(previous ?? {travelStart: '', travelEnd: '', travelFee: 0, mealFee: 0}), miscFee: 0}), includeTravel: true, includeSubsidies: true });
      else {
        remembered.current = current;
        onChange({travelStart: '-', travelEnd: '-', travelFee: 0, mealFee: 0, miscFee: 0, includeTravel: false, includeSubsidies: false});
      }
    }} />包含补贴{batch ? '（每条）' : ''}</label>
    <div className="form-grid form-grid--three">
      <Field label="交通起点"><input disabled={!included} maxLength={300} value={included ? record.travelStart : ''} placeholder={previous?.travelStart || '-'} onChange={(e) => edit({travelStart: e.target.value})} /></Field>
      <Field label="交通终点"><input disabled={!included} maxLength={300} value={included ? record.travelEnd : ''} placeholder={previous?.travelEnd || '-'} onChange={(e) => edit({travelEnd: e.target.value})} /></Field>
      <Field label={batch ? '每条交通费（往返）' : '交通费（往返）'}><NumberInput disabled={!included} value={included ? record.travelFee : 0} placeholder={included ? '0' : String(previous?.travelFee ?? 0)} onChange={(travelFee) => edit({travelFee})} /></Field>
      <Field label={batch ? '每条餐补' : '餐补'}><NumberInput disabled={!included} value={included ? record.mealFee ?? 0 : 0} placeholder={included ? '0' : String(previous?.mealFee ?? 0)} onChange={(mealFee) => edit({mealFee})} /></Field>
      <Field label={batch ? '每条杂费' : '杂费'}><NumberInput disabled={!included} value={included ? record.miscFee ?? 0 : 0} onChange={(miscFee) => edit({miscFee})} /></Field>
    </div>
    {warning && <p className="muted-text">{warning}</p>}
  </div>;
}
