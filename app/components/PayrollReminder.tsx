'use client';
import { useEffect, useState } from 'react';
import { appPath } from '../lib/app-path';

const reminder = '请【最晚】在三号之前完成上个月的工资申报并提交';
export function PayrollReminder() {
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setFinished(true), 24000);
    return () => window.clearTimeout(timer);
  }, []);
  return <aside className="payroll-reminder" aria-label="申报截止提醒" data-finished={finished}>
    <style>{`@font-face{font-family:PayrollReminderPixel;src:url("${appPath('/fonts/payroll-reminder.woff2')}") format("woff2");font-weight:400;font-style:normal;font-display:swap;}`}</style>
    {!finished && <span className="sr-only">{reminder}</span>}
    <div className="payroll-reminder__window" aria-hidden="true">{!finished && <div className="payroll-reminder__track" onAnimationEnd={() => setFinished(true)}><span>{reminder}</span></div>}</div>
  </aside>;
}
