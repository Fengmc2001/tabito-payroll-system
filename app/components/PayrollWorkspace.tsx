'use client';

import { AccountRole, SalaryRecord } from '../lib/payroll';
import { DelegatedSalaryWorkspace } from './DelegatedSalaryWorkspace';
import { SalaryWorkspace } from './SalaryWorkspace';

export type PayrollMode = 'self' | 'single' | 'batch' | 'self-batch';

export function PayrollWorkspace({
  currentUserId,
  role,
  mode,
  records,
  onSave,
  onDelete,
  onApply,
  onRefresh,
  onUpload,
}: {
  currentUserId: string;
  role: AccountRole;
  mode: PayrollMode;
  records: SalaryRecord[];
  onSave: (record: SalaryRecord) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onApply: (month: string) => Promise<number>;
  onRefresh: () => Promise<void>;
  onUpload?: (file: File) => Promise<string>;
}) {
  const privileged = role === 'admin';
  if (mode === 'self-batch') return <DelegatedSalaryWorkspace currentUserId={currentUserId} mode="batch" selfMode />;
  if (!privileged || mode === 'self') {
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
  return <div className="payroll-route">
    <section className="content-card payroll-route__header">
      <div>
        <p className="eyebrow">02 工资申报</p>
        <h1>工资申报</h1>
      </div>
    </section>
    <div className="payroll-route__panel">
      <DelegatedSalaryWorkspace currentUserId={currentUserId} mode={mode} />
    </div>
  </div>;
}
