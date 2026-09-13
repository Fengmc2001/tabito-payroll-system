'use client';
import {FormEvent, useRef, useState} from 'react';
import {ReviewSalaryItem} from '../lib/payroll';
import {employeeName, rejectionReasonError, REVIEW_MEMO_LIMIT} from '../lib/review-table';
import {useModalFocus} from './interaction-guards';
import {Money} from './payroll-ui';
import {Field} from './form-controls';

export type ReviewFailure = {message: string; stale: boolean};
export function ReviewRejectDialog({item,onClose,onConfirm}:{
  item:ReviewSalaryItem; onClose:()=>void;
  onConfirm:(reason:string)=>Promise<ReviewFailure|null>;
}) {
  const [reason,setReason]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [stale,setStale]=useState(false);
  const sending=useRef(false);
  const ref=useModalFocus(onClose,busy);
  const record=item.record;
  async function submit(event:FormEvent) {
    event.preventDefault();
    if(sending.current || stale) return;
    const invalid=rejectionReasonError(reason);
    if(invalid){setError(invalid);return;}
    sending.current=true;setBusy(true);setError('');
    try {
      const result=await onConfirm(reason.trim());
      if(result){setError(result.message);setStale(result.stale);} else onClose();
    } finally {sending.current=false;setBusy(false);}
  }
  return <div className="modal-backdrop review-reject-backdrop"><section ref={ref} tabIndex={-1} className="small-modal review-reject-dialog" role="dialog" aria-modal="true" aria-labelledby="reject-title">
    <header><h2 id="reject-title">确认驳回工资</h2><button type="button" className="icon-button" aria-label="关闭驳回确认" disabled={busy} onClick={onClose}>×</button></header>
    <form onSubmit={submit}>
      <div className="reject-record-identity"><strong>{employeeName(item)}</strong><Money amount={record.finalSalary} currency={record.currency}/></div>
      <dl className="reject-record-context">
        <div><dt>工作日期</dt><dd>{record.workDate}</dd></div>
        <div><dt>工作负责人</dt><dd>{record.checkUser || '—'}</dd></div>
        <div className="reject-work-content"><dt>工作内容</dt><dd>{record.workContent || '—'}</dd></div>
      </dl>
      <Field label="驳回理由" required><textarea required maxLength={REVIEW_MEMO_LIMIT} rows={4} value={reason} disabled={busy||stale} onChange={event=>{setReason(event.target.value);setError('');}} aria-describedby={error?'reject-error':undefined}/></Field>
      {error && <p id="reject-error" className="review-reject-error" role="alert">{error}</p>}
      <footer><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>{stale?'关闭并查看最新记录':'取消'}</button><button type="submit" className="primary-button review-reject-confirm" disabled={busy||stale||!reason.trim()}>{busy?'正在驳回…':'确认驳回'}</button></footer>
    </form>
  </section></div>;
}
