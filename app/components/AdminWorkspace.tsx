'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiClientError, apiRequest } from '../lib/api-client';
import {
  ACCOUNT_STATUS_LABELS,
  AccountRole,
  AccountStatus,
  AuditLogItem,
  DepartmentOption,
  ManagedUser,
  ROLE_LABELS,
} from '../lib/payroll';
import { StatusMessage, invalidFormControlMessage } from './form-controls';
import { AuditTrailPanel } from './payroll-ui';

export function AdminWorkspace({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [departmentLabel, setDepartmentLabel] = useState('');
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [resetTarget, setResetTarget] = useState<ManagedUser | null>(null);
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'success' | 'error' | 'info'>('info');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [userResult, settingsResult, logResult, departmentResult] = await Promise.all([
        apiRequest<{ users: ManagedUser[] }>('/api/admin/users'),
        apiRequest<{ settings: { registrationOpen: boolean } }>('/api/admin/settings'),
        apiRequest<{ logs: AuditLogItem[] }>('/api/audit/recent'),
        apiRequest<{ departments: DepartmentOption[] }>('/api/admin/departments'),
      ]);
      setUsers(userResult.users);
      setRegistrationOpen(settingsResult.settings.registrationOpen);
      setLogs(logResult.logs);
      setDepartments(departmentResult.departments);
    } catch (error) {
      setTone('error');
      setMessage(errorText(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      apiRequest<{ users: ManagedUser[] }>('/api/admin/users'),
      apiRequest<{ settings: { registrationOpen: boolean } }>('/api/admin/settings'),
      apiRequest<{ logs: AuditLogItem[] }>('/api/audit/recent'),
      apiRequest<{ departments: DepartmentOption[] }>('/api/admin/departments'),
    ]).then(([userResult, settingsResult, logResult, departmentResult]) => {
      if (!cancelled) {
        setUsers(userResult.users);
        setRegistrationOpen(settingsResult.settings.registrationOpen);
        setLogs(logResult.logs);
        setDepartments(departmentResult.departments);
      }
    }).catch((error) => {
      if (!cancelled) {
        setTone('error');
        setMessage(errorText(error));
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const updateDraft = (id: string, field: 'role' | 'status' | 'workManager', value: AccountRole | AccountStatus | boolean) => {
    setUsers((current) => current.map((user) => user.id === id ? { ...user, [field]: value } : user));
  };

  const saveUser = async (user: ManagedUser) => {
    setBusyId(user.id);
    try {
      const result = await apiRequest<{ user: ManagedUser }>(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: { role: user.role, status: user.status, workManager: user.workManager },
      });
      setUsers((current) => current.map((candidate) => candidate.id === user.id ? result.user : candidate));
      setTone('success');
      setMessage(`已更新 ${user.displayName} 的账号权限。`);
      void refreshLogs(setLogs);
    } catch (error) {
      setTone('error');
      setMessage(errorText(error));
      void load();
    } finally {
      setBusyId('');
    }
  };

  const revokeSessions = async (user: ManagedUser) => {
    setBusyId(user.id);
    try {
      await apiRequest(`/api/admin/users/${user.id}`, { method: 'PATCH', body: { revokeSessions: true } });
      setTone('success');
      setMessage(`已撤销 ${user.displayName} 的全部登录会话。`);
      void refreshLogs(setLogs);
    } catch (error) {
      setTone('error');
      setMessage(errorText(error));
    } finally {
      setBusyId('');
    }
  };

  const toggleRegistration = async () => {
    try {
      const result = await apiRequest<{ settings: { registrationOpen: boolean } }>('/api/admin/settings', {
        method: 'PATCH',
        body: { registrationOpen: !registrationOpen },
      });
      setRegistrationOpen(result.settings.registrationOpen);
      setTone('success');
      setMessage(result.settings.registrationOpen ? '新账号注册已开放。' : '新账号注册已关闭。');
      void refreshLogs(setLogs);
    } catch (error) {
      setTone('error');
      setMessage(errorText(error));
    }
  };

  const addDepartment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!departmentLabel.trim()) return;
    setBusyId('department-new');
    try {
      const result = await apiRequest<{ department: DepartmentOption }>('/api/admin/departments', {
        method: 'POST', body: { label: departmentLabel },
      });
      setDepartments((current) => [...current, result.department]);
      setDepartmentLabel('');
      setTone('success');
      setMessage(`已新增工作所属部门“${result.department.label}”。`);
      void refreshLogs(setLogs);
    } catch (error) {
      setTone('error');
      setMessage(errorText(error));
    } finally {
      setBusyId('');
    }
  };

  const removeDepartment = async (department: DepartmentOption) => {
    setBusyId(department.key);
    try {
      const result = await apiRequest<{ department: DepartmentOption }>(`/api/admin/departments/${department.key}`, { method: 'DELETE' });
      setDepartments((current) => current.map((item) => item.key === result.department.key ? result.department : item));
      setTone('success');
      setMessage(`已停用“${department.label}”；历史申报仍保留当时的部门名称。`);
      void refreshLogs(setLogs);
    } catch (error) {
      setTone('error');
      setMessage(errorText(error));
    } finally {
      setBusyId('');
    }
  };

  return (
    <section className="content-card admin-workspace">
      <div className="content-card__heading">
        <div>
          <p className="eyebrow">05 账号权限</p>
          <h1>账号与权限</h1>
        </div>
        <button type="button" className="secondary-button" disabled={loading} onClick={() => void load()}>刷新</button>
      </div>

      <div className="admin-setting-card">
        <div>
          <strong>新账号注册</strong>
          <span>{registrationOpen ? '已开放' : '已关闭'}</span>
        </div>
        <button type="button" className={registrationOpen ? 'secondary-button danger-button' : 'primary-button'} onClick={() => void toggleRegistration()}>
          {registrationOpen ? '关闭注册' : '开放注册'}
        </button>
      </div>

      <StatusMessage message={message} tone={tone} />

      <div className="department-admin-card">
        <div className="section-heading-inline">
          <div><h2>工作所属部门</h2></div>
        </div>
        <form
          className="department-add-form"
          onSubmit={addDepartment}
          onInvalidCapture={(event) => {
            setTone('error');
            setMessage(invalidFormControlMessage(event));
          }}
        >
          <input value={departmentLabel} onChange={(event) => setDepartmentLabel(event.target.value)} placeholder="新部门选项名称" maxLength={80} required />
          <button type="submit" className="primary-button" disabled={busyId === 'department-new'}>增加</button>
        </form>
        <div className="department-chip-list">
          {departments.map((department) => <span key={department.key} className={department.active ? 'department-chip' : 'department-chip department-chip--inactive'}>
            <b>{department.label}</b><small>{department.active ? '使用中' : '已停用'}</small>
            {department.active && <button type="button" disabled={busyId === department.key} onClick={() => void removeDepartment(department)}>删除</button>}
          </span>)}
        </div>
      </div>

      {loading ? (
        <div className="empty-state">正在加载账号权限…</div>
      ) : (
        <div className="data-table-wrap admin-users-table">
          <table className="data-table">
            <thead><tr><th>账号</th><th>角色</th><th>状态</th><th>工作负责人</th><th>最近登录</th><th>操作</th></tr></thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td><strong>{user.displayName}</strong><small>{user.email}{user.id === currentUserId ? ' · 当前账号' : ''}</small></td>
                  <td>
                    <select value={user.role} disabled={user.id === currentUserId} onChange={(event) => updateDraft(user.id, 'role', event.target.value as AccountRole)}>
                      {(Object.keys(ROLE_LABELS) as AccountRole[]).map((role) => <option value={role} key={role}>{ROLE_LABELS[role]}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={user.status} disabled={user.id === currentUserId} onChange={(event) => updateDraft(user.id, 'status', event.target.value as AccountStatus)}>
                      {(Object.keys(ACCOUNT_STATUS_LABELS) as AccountStatus[]).map((status) => <option value={status} key={status}>{ACCOUNT_STATUS_LABELS[status]}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={user.workManager ? 'yes' : 'no'} onChange={(event) => updateDraft(user.id, 'workManager', event.target.value === 'yes')}>
                      <option value="yes">可被选为负责人</option>
                      <option value="no">不可被选择</option>
                    </select>
                  </td>
                  <td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('zh-CN') : '尚未登录'}</td>
                  <td>
                    <div className="row-actions admin-row-actions">
                      <button type="button" disabled={busyId === user.id} onClick={() => void saveUser(user)}>保存</button>
                      <button type="button" disabled={busyId === user.id} onClick={() => void revokeSessions(user)}>撤销会话</button>
                      <button type="button" disabled={busyId === user.id} onClick={() => setResetTarget(user)}>重置密码</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AuditTrailPanel logs={logs} />

      {resetTarget && (
        <PasswordResetDialog
          user={resetTarget}
          onClose={() => setResetTarget(null)}
          onSuccess={(text) => {
            setResetTarget(null);
            setTone('success');
            setMessage(text);
            void refreshLogs(setLogs);
          }}
        />
      )}
    </section>
  );
}

function PasswordResetDialog({ user, onClose, onSuccess }: { user: ManagedUser; onClose: () => void; onSuccess: (message: string) => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password.length < 8) return setMessage('临时密码至少需要 8 位。');
    if (password !== confirm) return setMessage('两次输入的密码不一致。');
    setBusy(true);
    try {
      await apiRequest(`/api/admin/users/${user.id}/password`, {
        method: 'POST',
        body: { newPasswordDigest: await digestPassword(password) },
      });
      onSuccess(`已为 ${user.displayName} 重置密码，并撤销该账号的全部会话。`);
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="small-modal" role="dialog" aria-modal="true" aria-labelledby="admin-password-title">
        <header><div><h2 id="admin-password-title">重置 {user.displayName} 的密码</h2></div><button className="icon-button" type="button" onClick={onClose}>×</button></header>
        <form
          onSubmit={submit}
          onInvalidCapture={(event) => setMessage(invalidFormControlMessage(event))}
        >
          <label><span>新临时密码</span><input type="password" minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          <label><span>确认临时密码</span><input type="password" minLength={8} maxLength={128} value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></label>
          <StatusMessage message={message} tone="error" />
          <footer><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={busy}>{busy ? '处理中…' : '确认重置'}</button></footer>
        </form>
      </section>
    </div>
  );
}

async function refreshLogs(setLogs: (logs: AuditLogItem[]) => void) {
  try {
    const result = await apiRequest<{ logs: AuditLogItem[] }>('/api/audit/recent');
    setLogs(result.logs);
  } catch {
    // The preceding action already reports its own result.
  }
}

async function digestPassword(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function errorText(error: unknown) {
  return error instanceof ApiClientError ? error.message : error instanceof Error ? error.message : '请求失败。';
}
