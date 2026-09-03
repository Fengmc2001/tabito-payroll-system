'use client';

import { KeyboardEvent, useRef, useState } from 'react';
import { CalendarRange, UserPlus, UserRound } from 'lucide-react';
import { AccountRole, SalaryRecord } from '../lib/payroll';
import { DelegatedSalaryWorkspace } from './DelegatedSalaryWorkspace';
import { SalaryWorkspace } from './SalaryWorkspace';

type PayrollTab = 'self' | 'single' | 'batch';

export function PayrollWorkspace({
  currentUserId,
  role,
  records,
  onSave,
  onDelete,
  onApply,
  onRefresh,
  onUpload,
}: {
  currentUserId: string;
  role: AccountRole;
  records: SalaryRecord[];
  onSave: (record: SalaryRecord) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onApply: (month: string) => Promise<number>;
  onRefresh: () => Promise<void>;
  onUpload?: (file: File) => Promise<string>;
}) {
  const privileged = role === 'reviewer' || role === 'admin';
  const [tab, setTab] = useState<PayrollTab>('self');
  const tabButtons = useRef<Array<HTMLButtonElement | null>>([]);
  if (!privileged) {
    return <SalaryWorkspace
      userId={currentUserId}
      records={records}
      onSave={onSave}
      onDelete={onDelete}
      onApply={onApply}
      onRefresh={onRefresh}
      onUpload={onUpload}
    />;
  }
  const tabs = [
    { key: 'self' as const, label: '本人申报', icon: UserRound },
    { key: 'single' as const, label: '他人单条申报', icon: UserPlus },
    { key: 'batch' as const, label: '他人多条申报', icon: CalendarRange },
  ];
  const activateTab = (nextTab: PayrollTab) => {
    setTab(nextTab);
    if (nextTab === 'self') void onRefresh();
  };
  const moveTabFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    activateTab(tabs[nextIndex].key);
    tabButtons.current[nextIndex]?.focus();
  };
  return <div className="payroll-route">
    <section className="content-card payroll-route__header">
      <div>
        <p className="eyebrow">02 工资申报</p>
        <h1>工资申报</h1>
      </div>
      <div className="salary-subtabs" role="tablist" aria-label="工资申报方式">
        {tabs.map((item, index) => {
          const Icon = item.icon;
          return <button
            key={item.key}
            id={`payroll-tab-${item.key}`}
            ref={(node) => { tabButtons.current[index] = node; }}
            type="button"
            role="tab"
            aria-controls="payroll-panel"
            aria-selected={tab === item.key}
            tabIndex={tab === item.key ? 0 : -1}
            className={tab === item.key ? 'is-active' : ''}
            onClick={() => activateTab(item.key)}
            onKeyDown={(event) => moveTabFocus(event, index)}
          >
            <Icon size={17} aria-hidden="true" />{item.label}
          </button>;
        })}
      </div>
    </section>
    <div
      id="payroll-panel"
      className="payroll-route__panel"
      role="tabpanel"
      aria-labelledby={`payroll-tab-${tab}`}
    >
      {tab === 'self' ? <SalaryWorkspace
        embedded
        userId={currentUserId}
        records={records}
        onSave={onSave}
        onDelete={onDelete}
        onApply={onApply}
        onRefresh={onRefresh}
        onUpload={onUpload}
      /> : <DelegatedSalaryWorkspace currentUserId={currentUserId} mode={tab} />}
    </div>
  </div>;
}
