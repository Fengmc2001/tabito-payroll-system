'use client';
import { useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { appPath } from '../lib/app-path';

const reminder = '请【最晚】在三号之前完成上个月的工资申报并提交';
export function PayrollReminder() {
  const [paused, setPaused] = useState(false);
  return <aside className="payroll-reminder" aria-label="申报截止提醒" data-paused={paused}>
    <style>{`@font-face{font-family:PayrollReminderPixel;src:url("${appPath('/fonts/payroll-reminder.woff2')}") format("woff2");font-weight:400;font-style:normal;font-display:swap;}`}</style>
    <span className="sr-only">{reminder}</span>
    <div className="payroll-reminder__window" aria-hidden="true"><div className="payroll-reminder__track"><span>{reminder}</span><span>{reminder}</span></div></div>
    <button type="button" aria-label={paused ? '播放申报提醒' : '暂停申报提醒'} aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? <Play size={16} /> : <Pause size={16} />}</button>
  </aside>;
}
