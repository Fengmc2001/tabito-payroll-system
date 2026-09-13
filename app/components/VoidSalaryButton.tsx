'use client';
import { useState } from 'react';
import { SalaryRecord } from '../lib/payroll';
import { apiRequest } from '../lib/api-client';
import { Field, StatusMessage } from './form-controls';
import { useFeedback, useModalFocus } from './interaction-guards';
import { Money } from './payroll-ui';

export function VoidSalaryButton({record, onSaved}: {record: SalaryRecord; onSaved: () => Promise<void>}) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="danger-text" onClick={() => setOpen(true)}>作废</button>{open && <VoidDialog record={record} onClose={() => setOpen(false)} onSaved={onSaved} />}</>;
}
function VoidDialog({record, onClose, onSaved}: {record: SalaryRecord; onClose: () => void; onSaved: () => Promise<void>}) {
  const [reason, setReason] = useState('');
  const [paymentChecked, setPaymentChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError, revision] = useFeedback();
  const ref = useModalFocus(onClose, busy);
  return <div className="modal-backdrop"><section ref={ref} tabIndex={-1} className="small-modal" role="dialog" aria-modal="true" aria-label="作废工资">
    <header><h2>作废工资</h2><button type="button" className="icon-button" aria-label="关闭作废" disabled={busy} onClick={onClose}>×</button></header>
    <form onSubmit={async (event) => {
      event.preventDefault(); if (busy) return; setBusy(true);
      try {
        await apiRequest(`/api/salary-records/${record.id}/void`, {method: 'POST', body: {expectedUpdatedAt: record.updatedAt, reason, paymentChecked}});
        await onSaved(); onClose();
      } catch (e) { setError(e instanceof Error ? e.message : '作废失败。'); } finally { setBusy(false); }
    }}>
      <p>{record.workDate} · <Money amount={record.finalSalary} currency={record.currency} /></p>
      <p>作废后不再计入工资汇总，原申报、附件和审批记录仍保留。</p>
      <Field label="作废原因" required><textarea required maxLength={1000} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} rows={3} /></Field>
      <label className="access-check"><input type="checkbox" required checked={paymentChecked} disabled={busy} onChange={(e) => setPaymentChecked(e.target.checked)} />已核对是否付款；我知道作废不会撤销已发生的转账。</label>
      <StatusMessage message={error} tone="error" eventId={revision} />
      <footer><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="primary-button danger-button" disabled={busy}>{busy ? '处理中…' : '确认作废'}</button></footer>
    </form>
  </section></div>;
}
