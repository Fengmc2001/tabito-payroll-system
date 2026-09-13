'use client';
import { useEffect, useState } from 'react';
import { ManagedUser, SalaryRecord } from '../lib/payroll';
import { apiRequest } from '../lib/api-client';
import { useFeedback, useModalFocus } from './interaction-guards';
import { Field, StatusMessage } from './form-controls';

export function ReviewAssignment({record,onSaved}: {record:SalaryRecord;onSaved:()=>Promise<void>}) {
  const [open,setOpen]=useState(false);
  return <><button type="button" onClick={()=>setOpen(true)}>{record.reviewerUserId ? '转交审核' : '分配审核员'}</button>{open && <AssignmentDialog record={record} onClose={()=>setOpen(false)} onSaved={onSaved}/>}</>;
}
function AssignmentDialog({record,onClose,onSaved}:{record:SalaryRecord;onClose:()=>void;onSaved:()=>Promise<void>}) {
  const [users,setUsers]=useState<ManagedUser[]>([]);
  const [selected,setSelected]=useState(record.reviewerUserId || '');
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [message,setMessage,revision]=useFeedback();
  const ref=useModalFocus(onClose,busy);
  useEffect(()=>{let active=true; void apiRequest<{users:ManagedUser[]}>('/api/admin/users').then((r)=>{if(active)setUsers(r.users.filter(u=>u.status==='active'&&u.role!=='employee'&&(u.role==='admin'||u.id!==record.userId||u.access?.subjectUserIds.includes(u.id))));}).catch(e=>{if(active)setMessage(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[setMessage, record.userId]);
  async function save(){
    if(busy||loading)return;setBusy(true);
    try {await apiRequest('/api/review/salary-records/'+record.id+'/assign',{method:'PATCH',body:{reviewerUserId:selected||null,expectedUpdatedAt:record.updatedAt}}); await onSaved();onClose();}
    catch(e){setMessage(e instanceof Error?e.message:'转交失败。');}finally{setBusy(false);}
  }
  return <div className="modal-backdrop"><section ref={ref} tabIndex={-1} className="small-modal" role="dialog" aria-modal="true" aria-label="分配或转交审核">
    <header><h2>分配或转交审核</h2><button type="button" className="icon-button" disabled={busy} onClick={onClose} aria-label="关闭审核分配">×</button></header>
    <form onSubmit={(event)=>{event.preventDefault();void save();}}>
    <Field label="指定审核员"><select aria-label="指定审核员" disabled={busy||loading} value={selected} onChange={e=>setSelected(e.target.value)}>
      <option value="">未指定审核员，由管理员处理</option>
      {selected&&!users.some(u=>u.id===selected)&&<option value={selected}>原审核员已不可用，请重新选择</option>}
      {users.map(u=><option key={u.id} value={u.id}>{u.displayName}{users.some(other=>other.id!==u.id&&other.displayName===u.displayName) ? ` · ${u.email}` : ''}</option>)}
    </select></Field>
    <p className="dialog-help">仅转交这条待审申报，保留原审批记录。原审核员如另有该员工的完整资料与审批授权，仍可审核。</p>
    <StatusMessage message={message} eventId={revision} tone="error"/>
    <footer><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={busy||loading}>{busy?'保存中…':'确认分配'}</button></footer>
    </form>
  </section></div>;
}
