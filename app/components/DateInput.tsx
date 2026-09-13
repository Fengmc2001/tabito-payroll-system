'use client';

import {InputHTMLAttributes, useState} from 'react';
import {CalendarDays, ChevronLeft, ChevronRight} from 'lucide-react';
import {currentMonth, dateIsValid} from '../lib/payroll';
import {useModalFocus} from './interaction-guards';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value'|'onChange'|'type'|'min'|'max'> & {
  value: string; onChange: (value: string) => void; min?: string; max?: string;
};
export function DateInput({value,onChange,min,max,disabled,...props}:Props) {
  const [open,setOpen]=useState(false);
  return <span className="date-input">
    <input {...props} type="date" value={value} min={min} max={max} disabled={disabled}
      onChange={e=>onChange(e.target.value)} onClick={e=>{e.preventDefault();setOpen(true);}}
      onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setOpen(true);}}} />
    <CalendarDays className="date-input__icon" size={18} aria-hidden="true" />
    {open && !disabled && <DateCalendar value={value} min={min} max={max} onClose={()=>setOpen(false)} onSelect={date=>{onChange(date);setOpen(false);}} />}
  </span>;
}
function DateCalendar({value,min,max,onSelect,onClose}:{value:string;min?:string;max?:string;onSelect:(date:string)=>void;onClose:()=>void}) {
  const [month,setMonth]=useState(dateIsValid(value)?value.slice(0,7):min?.slice(0,7)||currentMonth());
  const ref=useModalFocus(onClose);
  const [year,number]=month.split('-').map(Number);
  const start=new Date(Date.UTC(year,number-1,1)).getUTCDay();
  const days=new Date(Date.UTC(year,number,0)).getUTCDate();
  const shift=(offset:number)=>new Date(Date.UTC(year,number-1+offset,1)).toISOString().slice(0,7);
  return <span className="date-calendar-backdrop" onClick={e=>{e.preventDefault();e.stopPropagation();onClose();}}>
    <section ref={ref} tabIndex={-1} className="date-calendar" role="dialog" aria-modal="true" aria-label="选择工作日期" onClick={e=>{e.preventDefault();e.stopPropagation();}}>
      <header><button type="button" aria-label="上个月" disabled={Boolean(min && shift(-1)<min.slice(0,7))} onClick={()=>setMonth(shift(-1))}><ChevronLeft size={18}/></button><strong>{year} 年 {number} 月</strong><button type="button" aria-label="下个月" disabled={Boolean(max && shift(1)>max.slice(0,7))} onClick={()=>setMonth(shift(1))}><ChevronRight size={18}/></button></header>
      <div className="date-calendar__grid">
        {['日','一','二','三','四','五','六'].map(day=><span key={day} className="date-calendar__weekday">{day}</span>)}
        {Array.from({length:start},(_,i)=><span key={'blank-'+i}/>)}
        {Array.from({length:days},(_,i)=>{
          const date=`${month}-${String(i+1).padStart(2,'0')}`;
          return <button type="button" key={date} aria-label={`选择 ${date}`} aria-pressed={date===value} disabled={Boolean((min && date<min)||(max && date>max))} onClick={()=>onSelect(date)}>{i+1}</button>;
        })}
      </div>
      <button type="button" className="date-calendar__close" onClick={onClose}>取消</button>
    </section>
  </span>;
}
