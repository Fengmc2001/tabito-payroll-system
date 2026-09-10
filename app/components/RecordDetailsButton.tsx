'use client';
import { useState } from 'react';
import { RecordHistoryItem, SalaryRecord, STATUS, formatHours, formatJapanDateTime, getApplyTypeLabel, getDepartmentLabel } from '../lib/payroll';
import { apiRequest } from '../lib/api-client';
import { appPath } from '../lib/app-path';
import { Money } from './payroll-ui';
import { useModalFocus } from './interaction-guards';

export function RecordDetailsButton({record}: {record: SalaryRecord}) {
  const [open, setOpen] = useState(false);
  return <><button type="button" onClick={() => setOpen(true)}>详情与审批记录</button>{open && <RecordDetails id={record.id} onClose={() => setOpen(false)} />}</>;
}
function RecordDetails({id, onClose}: {id: string; onClose: () => void}) {
  const [result, setResult] = useState<{record: SalaryRecord; history: RecordHistoryItem[]} | null>(null);
  const [message, setMessage] = useState('');
  const [started, setStarted] = useState(false);
  const modalRef = useModalFocus(onClose, false);
  // Loading lives in a child effect to cancel responses after closing the dialog.
  return <div className="modal-backdrop"><section ref={modalRef} tabIndex={-1} className="small-modal record-detail-modal" role="dialog" aria-modal="true" aria-label="工资明细与审批记录">
    <header><h2>工资明细与审批记录</h2><button type="button" className="icon-button" onClick={onClose} aria-label="关闭详情">×</button></header>
    <HistoryLoader id={id} onResult={setResult} onError={setMessage} onStart={setStarted} />
    {message ? <p role="alert">{message}</p> : !result ? <p>{started ? '正在加载…' : '正在检查查看权限…'}</p> : <>
      <RecordContent record={result.record} />
      <h3>提交与审批记录</h3>
      <div className="record-history-list">{result.history.length ? result.history.map((h) => <article className="record-history-entry" key={h.id}>
        <strong>{historyAction(h.action)} · {h.actorName}</strong><p>{formatJapanDateTime(h.createdAt)}</p>
        {h.record ? <details><summary>查看当时的申报内容</summary><RecordContent record={h.record} /></details> : <p>{h.auditMemo && <span>审核备注：{h.auditMemo}<br /></span>}旧版操作记录未保存当时的明细快照。</p>}
      </article>) : <p>这条旧申报尚无历史快照，现有审批结果见上方。</p>}</div>
    </>}
  </section></div>;
}
import { useEffect } from 'react';
function HistoryLoader({id,onResult,onError,onStart}: {id:string;onResult:(value:{record:SalaryRecord;history:RecordHistoryItem[]})=>void;onError:(value:string)=>void;onStart:(value:boolean)=>void}) {
  useEffect(() => {let active = true; onStart(true);
    void apiRequest<{record:SalaryRecord;history:RecordHistoryItem[]}>(`/api/salary-records/${id}/history`).then((data) => {if(active) onResult(data);}).catch((error) => {if(active) onError(error instanceof Error ? error.message : '加载失败。');});
    return () => {active = false;};
  },[id,onResult,onError,onStart]);
  return null;
}
function RecordContent({record:r}: {record: SalaryRecord}) {
  return <div><div className="section-heading-inline"><strong>{r.workDate} · {STATUS[r.status].label}</strong><Money amount={r.finalSalary} currency={r.currency} /></div>
    <dl className="record-detail-grid">
      <div><dt>工作负责人</dt><dd>{r.checkUser || '—'}</dd></div>
      {r.status !== 1 && <div><dt>指定审核员</dt><dd>{r.reviewerName || (r.reviewerUserId ? '已分配' : '管理员待办')}</dd></div>}
      <div><dt>部门</dt><dd>{getDepartmentLabel(r.departmentKey,r.departmentLabel)}</dd></div>
      <div><dt>计费方式</dt><dd>{getApplyTypeLabel(r.applyType)}</dd></div>
      <div><dt>单价</dt><dd><Money amount={r.rate} currency={r.currency} /></dd></div>
      <div><dt>数量</dt><dd>{r.amount}</dd></div>
      <div><dt>时间</dt><dd>{r.startTime && r.endTime ? r.startTime + '–' + r.endTime : '—'}</dd></div>
      <div><dt>计薪 / 休息</dt><dd>{formatHours(r.workHours)} / {formatHours(r.restHours)} 小时</dd></div>
      <div><dt>交通费</dt><dd><Money amount={r.travelFee} currency={r.currency} /></dd></div>
      <div><dt>交通区间</dt><dd>{[r.travelStart,r.travelEnd].filter(Boolean).join(' → ') || '—'}</dd></div>
    </dl>
    <p><b>工作内容：</b>{r.workContent || '—'}</p><p><b>备注：</b>{r.memo || '—'}</p>
    {r.auditMemo && <p><b>审核备注：</b>{r.auditMemo}</p>}
    {r.checkDate && <p>审批时间：{formatJapanDateTime(r.checkDate)}</p>}
    <div className="attachment-links">{r.attachments.map((key,index) => <a key={key} href={appPath('/api/files?key=' + encodeURIComponent(key))} target="_blank" rel="noreferrer">附件 {index+1}</a>)}</div>
  </div>;
}
function historyAction(action: string) {
  const names: Record<string,string> = {'salary.create':'创建草稿','salary.update':'修改草稿','salary.submit':'提交审核','salary.approve':'审核通过','salary.reject':'驳回','salary.reopen':'撤回或退回修改','salary.reassign':'转交审核','salary.proxy_submit':'代报提交','salary.proxy_create':'创建代报','salary.proxy_update':'修改代报','salary.proxy_batch_submit':'批量提交','salary.proxy_batch_create':'批量创建','salary.rule_generate':'定期生成'};
  return names[action] || '申报变更';
}
