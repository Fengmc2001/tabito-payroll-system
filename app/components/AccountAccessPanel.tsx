'use client';
import { useEffect, useState } from 'react';
import { AccountAccess, ManagedUser, FEATURE_LABELS, defaultFeatures } from '../lib/payroll';
import { apiRequest } from '../lib/api-client';
import { StatusMessage } from './form-controls';
import { useFeedback, useUnsavedChanges, confirmPageLeave } from './interaction-guards';

export function AccountAccessPanel({ users, onSaved, onEditingChange }: {users: ManagedUser[]; onSaved: (user: ManagedUser) => void; onEditingChange: (editing: boolean) => void}) {
  const [selectedId, setSelectedId] = useState('');
  const selected = users.find((u) => u.id === selectedId);
  return <section className="access-panel">
    <div className="section-heading-inline"><h2>查看与审核配置</h2></div>
    <label className="access-account-picker"><span>选择要配置的账号</span><select value={selectedId} onChange={async (event) => {
      const id = event.target.value; if (await confirmPageLeave()) setSelectedId(id);
    }}><option value="">请选择账号</option>{users.map((u) => <option key={u.id} value={u.id}>{u.displayName} · {u.email}</option>)}</select></label>
    {selected ? <AccessEditor key={selected.id + selected.updatedAt} user={selected} users={users} onSaved={onSaved} onEditingChange={onEditingChange} /> : <p className="muted-text">选择账号后，设置功能入口、资料查看范围和审核分配。</p>}
  </section>;
}
function AccessEditor({user, users, onSaved, onEditingChange}: {user: ManagedUser; users: ManagedUser[]; onSaved: (user: ManagedUser) => void; onEditingChange: (editing: boolean) => void}) {
  const initial: AccountAccess = user.access ?? {features: defaultFeatures(user.role), subjectUserIds: [], reviewerUserId: null};
  const [draft, setDraft] = useState<AccountAccess>({...initial, reviewerUserId: user.workManager ? initial.reviewerUserId : null});
  const [busy, setBusy] = useState(false);
  const [message, setMessage, revision] = useFeedback();
  const [search, setSearch] = useState('');
  const [tone, setTone] = useState<'success' | 'error'>('error');
  const dirty = JSON.stringify(draft) !== JSON.stringify({...initial, reviewerUserId: user.workManager ? initial.reviewerUserId : null});
  useUnsavedChanges(dirty, busy);
  useEffect(() => { onEditingChange(dirty || busy); return () => onEditingChange(false); }, [dirty, busy, onEditingChange]);
  const reviewers = users.filter((u) => u.status === 'active' && u.role !== 'employee');
  const targets = users.filter((u) => (u.displayName + u.email).toLowerCase().includes(search.toLowerCase())).sort((a, b) => Number(b.id === user.id) - Number(a.id === user.id));
  async function save() {
    if (busy || !dirty) return;
    setBusy(true);
    try {
      const result = await apiRequest<{user: ManagedUser}>(`/api/admin/users/${user.id}/access`, {method:'PATCH', body:{...draft, expectedUpdatedAt:user.updatedAt}});
      setTone('success'); setMessage('配置已保存。'); onSaved(result.user);
    } catch (error) { setTone('error'); setMessage(error instanceof Error ? error.message : '保存失败，请重试。'); }
    finally {setBusy(false);}
  }
  return <div className="access-editor"><fieldset className="form-operation-fields" disabled={busy}>
    <div className="access-editor__grid">
      <section className="access-card"><h3>可使用的功能</h3>
        {user.role === 'admin' ? <p>管理员始终拥有全部功能和资料权限。</p> : <>
          {(Object.keys(FEATURE_LABELS) as Array<keyof AccountAccess['features']>).map((key) => <label className="access-check" key={key}><input type="checkbox" checked={draft.features[key]} onChange={(e) => setDraft({...draft, features:{...draft.features,[key]:e.target.checked}})} />{FEATURE_LABELS[key]}</label>)}
          <p className="muted-text">开放功能不会增加可查看的员工，也不会授予审批或代报权限。</p>
        </>}
      </section>
      <section className="access-card"><h3>负责人对应审核员</h3>
        {user.workManager ? <label><span>{user.displayName} 负责的申报交给</span><select aria-label="指定审核员" value={draft.reviewerUserId || ''} onChange={(e) => setDraft({...draft,reviewerUserId:e.target.value || null})}>
          <option value="">按负责人角色自动分配</option>
          {draft.reviewerUserId && !reviewers.some((u) => u.id === draft.reviewerUserId) && <option value={draft.reviewerUserId}>原审核员已停用或不再有审核权限</option>}
          {reviewers.map((u) => <option key={u.id} value={u.id}>{u.displayName} · {u.email}</option>)}
        </select><small>未另行指定时，由具备审核角色的工作负责人本人审核。</small><small>本人工资需自审授权。仅影响后续提交，已有待审记录不改派。</small></label> : <p className="muted-text">该账号不是工作负责人，无需设置审核员。</p>}
      </section>
    </div>
    {user.role !== 'admin' && <section className="access-card"><h3>可查看完整资料并审批工资的员工 <span className="muted-text">已选 {draft.subjectUserIds.length} 人</span></h3>
      <p className="muted-text">可查看所选员工的已申报工资、收款资料、证件和附件，并通过或驳回其全部待审工资，不受负责人或指定审核员限制。普通员工账号同样生效，并自动获得“工资审批”入口。</p>
      <p className="muted-text">勾选本人可审批自己的工资；未勾选时，即使是指定审核员也不能自审。其他员工取消授权后，仅保留指定给该账号的审批权限。不含代报、转交或作废已通过工资。</p>
      <input aria-label="搜索授权员工" placeholder="搜索姓名或邮箱" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="access-targets">{targets.map((u) => <label className="access-check" key={u.id}><input type="checkbox" checked={draft.subjectUserIds.includes(u.id)} onChange={(e) => setDraft({...draft, subjectUserIds:e.target.checked ? [...draft.subjectUserIds,u.id] : draft.subjectUserIds.filter((id) => id !== u.id)})} /><span>{u.displayName}{u.id === user.id ? '（本人）' : ''}<small>{u.email}</small></span></label>)}</div>
      {draft.subjectUserIds.length > 0 && !draft.features.summary && !draft.features.employees && <p className="muted-text">查看完整收款资料和档案，还需开放“工资汇总”或“员工管理”；工资审批入口随授权自动开放。</p>}
      {draft.subjectUserIds.length === 0 && <p className="muted-text">未额外授权查看及审批其他员工的工资。</p>}
    </section>}
    <StatusMessage message={message} tone={tone} eventId={revision} />
    <div className="heading-actions"><button type="button" className="secondary-button" disabled={!dirty} onClick={() => setDraft({...initial, reviewerUserId:user.workManager ? initial.reviewerUserId : null})}>取消更改</button><button type="button" className="primary-button" disabled={!dirty || busy} onClick={() => void save()}>{busy ? '保存中…' : '保存查看与审核配置'}</button></div>
  </fieldset></div>;
}
