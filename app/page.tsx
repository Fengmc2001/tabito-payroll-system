'use client';

import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { AdminWorkspace } from './components/AdminWorkspace';
import { AuditWorkspace } from './components/AuditWorkspace';
import { EmployeeWorkspace } from './components/EmployeeWorkspace';
import { ProfileEditor } from './components/ProfileEditor';
import { ReviewWorkspace } from './components/ReviewWorkspace';
import { SalaryHistory, SalaryWorkspace } from './components/SalaryWorkspace';
import { Field, StatusMessage } from './components/form-controls';
import { ApiClientError, apiRequest } from './lib/api-client';
import {
  APP_TITLE,
  BOOTSTRAP_ADMIN_EMAIL,
  AppRoute,
  Profile,
  ROLE_LABELS,
  SalaryRecord,
  StoredAccount,
  profileBasicsAreReady,
  profileIsReady,
} from './lib/payroll';

type AuthResponse = { account: StoredAccount; session: { expiresAt: number } };

const AUTH_ROUTES: AppRoute[] = ['/account/login', '/account/register', '/account/forget'];
const ALL_ROUTES: AppRoute[] = [
  '/',
  '/account/login',
  '/account/register',
  '/account/forget',
  '/profile/first-setting',
  '/profile/setting',
  '/pay/salary',
  '/pay/history',
  '/review/salary',
  '/admin/users',
  '/staff/employees',
  '/audit/overview',
];

export default function HomePage() {
  const [activeAccount, setActiveAccount] = useState<StoredAccount | null>(null);
  const [route, setRoute] = useState<AppRoute>('/account/login');
  const [hydrated, setHydrated] = useState(false);
  const [systemMessage, setSystemMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    const restoreRoute = () => setRoute(readRoute());
    restoreRoute();
    window.addEventListener('hashchange', restoreRoute);
    void apiRequest<{ account: StoredAccount }>('/api/users')
      .then(({ account }) => {
        if (!cancelled) setActiveAccount(account);
      })
      .catch((error) => {
        if (!cancelled && !(error instanceof ApiClientError && error.status === 401)) {
          setSystemMessage(errorMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
      window.removeEventListener('hashchange', restoreRoute);
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (!activeAccount && !AUTH_ROUTES.includes(route)) {
      navigate('/account/login');
      return;
    }
    if (!activeAccount) return;
    if (AUTH_ROUTES.includes(route)) {
      navigate(profileBasicsAreReady(activeAccount.profile) ? '/' : '/profile/first-setting');
      return;
    }
    if (!profileBasicsAreReady(activeAccount.profile) && route !== '/profile/first-setting') {
      navigate('/profile/first-setting');
      return;
    }
    if (!profileIsReady(activeAccount.profile) && ['/pay/salary', '/pay/history'].includes(route)) {
      navigate('/profile/setting');
      return;
    }
    if (route === '/review/salary' && activeAccount.role === 'employee') {
      navigate('/');
      return;
    }
    if (['/staff/employees', '/audit/overview'].includes(route) && activeAccount.role === 'employee') {
      navigate('/');
      return;
    }
    if (route === '/admin/users' && activeAccount.role !== 'admin') navigate('/');
  }, [activeAccount, hydrated, route]);

  const register = async (email: string, password: string) => {
    try {
      const remote = await apiRequest<AuthResponse>('/api/users', {
        method: 'POST',
        body: { email, passwordDigest: await digestPassword(password) },
      });
      setActiveAccount(remote.account);
      setSystemMessage('');
      navigate('/profile/first-setting');
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  };

  const login = async (email: string, password: string) => {
    try {
      const remote = await apiRequest<AuthResponse>('/api/users/login', {
        method: 'POST',
        body: { email, passwordDigest: await digestPassword(password) },
      });
      setActiveAccount(remote.account);
      setSystemMessage('');
      navigate(profileBasicsAreReady(remote.account.profile) ? '/' : '/profile/first-setting');
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  };

  const logout = () => {
    setActiveAccount(null);
    setSystemMessage('');
    navigate('/account/login');
    void apiRequest('/api/users/logout', { method: 'POST' }).catch(() => undefined);
  };

  const saveProfile = async (profile: Profile) => {
    if (!activeAccount) return '登录状态已过期。';
    const userId = activeAccount.id;
    try {
      const { account } = await apiRequest<{ account: StoredAccount }>(`/api/users/${userId}`, {
        method: 'PATCH',
        body: { profile },
      });
      setActiveAccount(account);
      setSystemMessage('');
      if (route === '/profile/first-setting' && profileBasicsAreReady(account.profile)) navigate('/');
      return null;
    } catch (error) {
      const message = errorMessage(error);
      setSystemMessage(message);
      return message;
    }
  };

  const resetPassword = async (oldPassword: string, newPassword: string) => {
    try {
      await apiRequest('/api/users/reset-password', {
        method: 'POST',
        body: {
          oldPasswordDigest: await digestPassword(oldPassword),
          newPasswordDigest: await digestPassword(newPassword),
        },
      });
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  };

  const saveSalaryRecord = async (record: SalaryRecord) => {
    if (!activeAccount) throw new Error('登录状态已过期。');
    const exists = activeAccount.salaryRecords.some((item) => item.id === record.id);
    const result = await apiRequest<{ record: SalaryRecord }>(
      exists ? `/api/salary-records/${record.id}` : '/api/salary-records',
      { method: exists ? 'PATCH' : 'POST', body: record },
    );
    setActiveAccount((current) => current ? {
      ...current,
      salaryRecords: current.salaryRecords.some((item) => item.id === result.record.id)
        ? current.salaryRecords.map((item) => item.id === result.record.id ? result.record : item)
        : [result.record, ...current.salaryRecords],
    } : current);
  };

  const deleteSalaryRecord = async (id: string) => {
    await apiRequest(`/api/salary-records/${id}`, { method: 'DELETE' });
    setActiveAccount((current) => current ? {
      ...current,
      salaryRecords: current.salaryRecords.filter((record) => record.id !== id),
    } : current);
  };

  const applySalaryRecords = async (month: string) => {
    if (!activeAccount) throw new Error('登录状态已过期。');
    const result = await apiRequest<{ records: SalaryRecord[] }>(`/api/salary-records/apply/${activeAccount.id}`, {
      method: 'POST',
      body: { month },
    });
    const applied = new Map(result.records.map((record) => [record.id, record]));
    setActiveAccount((current) => current ? {
      ...current,
      salaryRecords: current.salaryRecords.map((record) => applied.get(record.id) ?? record),
    } : current);
    return result.records.length;
  };

  const refreshSalaryRecords = async () => {
    const result = await apiRequest<{ records: SalaryRecord[] }>('/api/salary-records');
    setActiveAccount((current) => current ? { ...current, salaryRecords: result.records } : current);
  };

  const uploadFile = async (file: File) => {
    const formData = new FormData();
    formData.set('file', file);
    const result = await apiRequest<{ file: { key: string } }>('/api/uploads', { method: 'POST', formData });
    return result.file.key;
  };

  if (!hydrated) return <main className="app-loading"><span>正在验证账号与权限…</span></main>;

  if (!activeAccount) {
    return <AuthPage key={route} route={route} onLogin={login} onRegister={register} initialMessage={systemMessage} />;
  }

  const content = route === '/profile/first-setting' ? (
    <ProfileEditor profile={activeAccount.profile} firstTime onSave={saveProfile} onResetPassword={resetPassword} onUpload={uploadFile} />
  ) : route === '/profile/setting' ? (
    <ProfileEditor profile={activeAccount.profile} onSave={saveProfile} onResetPassword={resetPassword} onUpload={uploadFile} />
  ) : route === '/pay/salary' ? (
    <SalaryWorkspace
      userId={activeAccount.id}
      records={activeAccount.salaryRecords}
      onSave={saveSalaryRecord}
      onDelete={deleteSalaryRecord}
      onApply={applySalaryRecords}
      onRefresh={refreshSalaryRecords}
      onUpload={uploadFile}
    />
  ) : route === '/pay/history' ? (
    <SalaryHistory records={activeAccount.salaryRecords} />
  ) : route === '/review/salary' && activeAccount.role !== 'employee' ? (
    <ReviewWorkspace />
  ) : route === '/admin/users' && activeAccount.role === 'admin' ? (
    <AdminWorkspace currentUserId={activeAccount.id} />
  ) : route === '/staff/employees' && activeAccount.role !== 'employee' ? (
    <EmployeeWorkspace />
  ) : route === '/audit/overview' && activeAccount.role !== 'employee' ? (
    <AuditWorkspace />
  ) : (
    <LandingPage account={activeAccount} onNavigate={navigate} />
  );

  return (
    <AppShell account={activeAccount} route={route} onNavigate={navigate} onLogout={logout}>
      {systemMessage && <StatusMessage message={systemMessage} tone="error" />}
      {content}
    </AppShell>
  );
}

function AuthPage({
  route,
  onLogin,
  onRegister,
  initialMessage,
}: {
  route: AppRoute;
  onLogin: (email: string, password: string) => Promise<string | null>;
  onRegister: (email: string, password: string) => Promise<string | null>;
  initialMessage: string;
}) {
  const mode = route === '/account/register' ? 'register' : route === '/account/forget' ? 'forget' : 'login';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState(initialMessage);
  const [tone, setTone] = useState<'success' | 'error' | 'info'>(initialMessage ? 'error' : 'info');
  const [busy, setBusy] = useState(false);
  const [bootstrapRequired, setBootstrapRequired] = useState(false);

  useEffect(() => {
    if (mode !== 'register') return;
    let cancelled = false;
    void apiRequest<{ bootstrap: { bootstrapRequired: boolean; email: string } }>('/api/bootstrap-status')
      .then(({ bootstrap }) => {
        if (!cancelled && bootstrap.bootstrapRequired) {
          setBootstrapRequired(true);
          setEmail(bootstrap.email || BOOTSTRAP_ADMIN_EMAIL);
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [mode]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode === 'forget') {
      setTone('info');
      setMessage('请联系管理员在“账号与权限”后台设置临时密码；邮件重置需部署邮件服务后启用。');
      return;
    }
    if (password.length < 8) {
      setTone('error');
      setMessage('密码至少需要 8 位。');
      return;
    }
    if (mode === 'register' && password !== confirm) {
      setTone('error');
      setMessage('两次输入的密码不一致。');
      return;
    }
    setBusy(true);
    const error = mode === 'login' ? await onLogin(email, password) : await onRegister(email, password);
    setBusy(false);
    if (error) {
      setTone('error');
      setMessage(error);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-card__brand"><span>工资申报</span><i /></div>
        <h1 id="auth-title">{mode === 'login' ? '登陆' : mode === 'register' ? '注册' : '忘记密码'} - {APP_TITLE}</h1>
        <p className="auth-card__hint">
          {mode === 'login' && '使用邮箱和密码进入工资申报系统。'}
          {mode === 'register' && (bootstrapRequired
            ? `当前是空数据库首次初始化：管理员账号固定为 ${BOOTSTRAP_ADMIN_EMAIL}，请自行设置密码。`
            : '注册后必须先填写姓名、现住址和多行联系方式，之后才能进入系统。')}
          {mode === 'forget' && '账号恢复由管理员后台处理。'}
        </p>
        <form className="auth-form" onSubmit={submit}>
          <Field label={bootstrapRequired ? '首个管理员账号' : '邮箱'} required><input type="email" value={email} readOnly={bootstrapRequired} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" required /></Field>
          {mode !== 'forget' && <Field label="密码" required><input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></Field>}
          {mode === 'register' && <Field label="确认密码" required><input type="password" minLength={8} value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></Field>}
          <StatusMessage message={message} tone={tone} />
          <button className="primary-button primary-button--large" type="submit" disabled={busy}>
            {busy ? '处理中…' : mode === 'login' ? '登陆' : mode === 'register' ? '注册' : '查看恢复方式'}
          </button>
        </form>
        <div className="auth-links" aria-label="账户操作">
          {mode !== 'login' && <button type="button" onClick={() => navigate('/account/login')}>返回登陆</button>}
          {mode === 'login' && <button type="button" onClick={() => navigate('/account/register')}>注册</button>}
          {mode === 'login' && <button type="button" onClick={() => navigate('/account/forget')}>忘记密码</button>}
        </div>
      </section>
    </main>
  );
}

function AppShell({
  account,
  route,
  onNavigate,
  onLogout,
  children,
}: {
  account: StoredAccount;
  route: AppRoute;
  onNavigate: (route: AppRoute) => void;
  onLogout: () => void;
  children: ReactNode;
}) {
  const name = `${account.profile.lastNameCn}${account.profile.firstNameCn}` || account.email;
  const onboardingReady = profileBasicsAreReady(account.profile);
  const profileReady = profileIsReady(account.profile);
  const links: Array<{ route: AppRoute; label: string }> = [
    { route: '/profile/setting', label: '个人&账户信息' },
    { route: '/pay/salary', label: '工资申报' },
    { route: '/pay/history', label: '往期工资一览' },
  ];
  if (account.role === 'reviewer' || account.role === 'admin') links.push({ route: '/review/salary', label: '工资审核' });
  if (account.role === 'reviewer' || account.role === 'admin') links.push({ route: '/staff/employees', label: '员工管理' });
  if (account.role === 'reviewer' || account.role === 'admin') links.push({ route: '/audit/overview', label: '总审计' });
  if (account.role === 'admin') links.push({ route: '/admin/users', label: '账号权限' });

  return (
    <main className="app-shell">
      <aside className="app-sidebar">
        <button className="brand-lockup" type="button" onClick={() => onNavigate('/')}>
          <strong>旅人教育</strong>
          <span>工资申报</span>
        </button>
        <nav className="app-nav" aria-label="主菜单">
          {links.map((link) => (
            <button
              key={link.route}
              type="button"
              disabled={!onboardingReady && link.route !== '/profile/setting'}
              className={route === link.route || (route === '/profile/first-setting' && link.route === '/profile/setting') ? 'is-active' : ''}
              onClick={() => onNavigate(link.route)}
            >
              {link.label}
            </button>
          ))}
        </nav>
        <div className="account-menu">
          <span className={`role-chip role-chip--${account.role}`}>{ROLE_LABELS[account.role]}</span>
          <span title={account.email}>{name}</span>
          <button type="button" onClick={onLogout}>登出</button>
        </div>
      </aside>
      <section className="app-main">
        {!profileReady && route !== '/profile/first-setting' && route !== '/profile/setting' && (
          <button className="profile-alert" type="button" onClick={() => onNavigate('/profile/setting')}>
            工资资料尚未完善；申报前请补全生日、证件与收款账户。
          </button>
        )}
        <div className="app-content">{children}</div>
      </section>
    </main>
  );
}

function LandingPage({ account, onNavigate }: { account: StoredAccount; onNavigate: (route: AppRoute) => void }) {
  const name = `${account.profile.lastNameCn}${account.profile.firstNameCn}` || '员工';
  const actions: Array<{ label: string; description: string; route: AppRoute; number: string }> = [
    { number: '01', label: '个人&账户信息', description: '完善个人资料、证件信息与工资收款账户。', route: '/profile/setting' },
    { number: '02', label: '工资申报', description: '新建、复制、提交工作记录并跟踪审核状态。', route: '/pay/salary' },
    { number: '03', label: '往期工资一览', description: '按月查看审核通过的工资、工时和支付信息。', route: '/pay/history' },
  ];
  if (account.role === 'reviewer' || account.role === 'admin') {
    actions.push({ number: '04', label: '工资审核', description: '审核员工提交的工资记录并查看受控附件。', route: '/review/salary' });
  }
  if (account.role === 'admin') {
    actions.push({ number: '05', label: '账号与权限', description: '管理角色、账号状态、会话、密码与审计日志。', route: '/admin/users' });
  }
  if (account.role === 'reviewer' || account.role === 'admin') {
    actions.push({ number: '06', label: '员工管理', description: '查看员工档案、全部附件、历史申报、月度工资与审批记录。', route: '/staff/employees' });
    actions.push({ number: '07', label: '总审计', description: '按月、年、部门、账号与币种追踪支出和操作。', route: '/audit/overview' });
  }

  return (
    <section className="content-card landing-card">
      <div className="landing-card__intro">
        <p className="eyebrow">工资申报</p>
        <h1>{name}，欢迎回来</h1>
        <p>当前角色：{ROLE_LABELS[account.role]}。请选择需要办理的事项。</p>
      </div>
      <div className="landing-actions">
        {actions.map((action) => (
          <button type="button" className="landing-action" key={action.route} onClick={() => onNavigate(action.route)}>
            <span>{action.number}</span>
            <strong>{action.label}</strong>
            <small>{action.description}</small>
            <i aria-hidden="true">→</i>
          </button>
        ))}
      </div>
    </section>
  );
}

function navigate(route: AppRoute) {
  window.location.hash = route;
}

function readRoute(): AppRoute {
  const value = window.location.hash.replace(/^#/, '') || '/account/login';
  return ALL_ROUTES.includes(value as AppRoute) ? value as AppRoute : '/account/login';
}

async function digestPassword(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function errorMessage(error: unknown) {
  return error instanceof ApiClientError ? error.message : error instanceof Error ? error.message : '无法连接到工资系统，请稍后重试。';
}
