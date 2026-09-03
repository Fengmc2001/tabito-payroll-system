'use client';

import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CalendarRange,
  ChartNoAxesCombined,
  ClipboardList,
  FileSpreadsheet,
  History,
  LogOut,
  ShieldCheck,
  UserPlus,
  UserRound,
  UsersRound,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import { AdminWorkspace } from './components/AdminWorkspace';
import { AuditWorkspace } from './components/AuditWorkspace';
import { EmployeeWorkspace } from './components/EmployeeWorkspace';
import { ProfileEditor } from './components/ProfileEditor';
import { PayrollWorkspace } from './components/PayrollWorkspace';
import { ReviewWorkspace } from './components/ReviewWorkspace';
import { SalaryHistory } from './components/SalaryWorkspace';
import { TransferSheetWorkspace } from './components/TransferSheetWorkspace';
import { Field, StatusMessage, invalidFormControlMessage } from './components/form-controls';
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
  profileMissingRequirements,
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
  '/pay/salary/single',
  '/pay/salary/batch',
  '/pay/history',
  '/review/salary',
  '/review/summary',
  '/admin/users',
  '/staff/employees',
  '/audit/overview',
];

export default function HomePage() {
  const [activeAccount, setActiveAccount] = useState<StoredAccount | null>(null);
  const [route, setRoute] = useState<AppRoute>('/account/login');
  const [hydrated, setHydrated] = useState(false);
  const [systemMessage, setSystemMessage] = useState('');
  const [profileGateMessage, setProfileGateMessage] = useState('');
  const [viewRevision, setViewRevision] = useState(0);

  const refreshAccount = useCallback(async () => {
    const { account } = await apiRequest<{ account: StoredAccount }>('/api/users');
    setActiveAccount(account);
    return account;
  }, []);

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
    if (!hydrated || !activeAccount?.id || AUTH_ROUTES.includes(route)) return;
    let cancelled = false;
    void apiRequest<{ account: StoredAccount }>('/api/users')
      .then(({ account }) => { if (!cancelled) setActiveAccount(account); })
      .catch((error) => {
        if (!cancelled) {
          if (error instanceof ApiClientError && error.status === 401) setActiveAccount(null);
          else setSystemMessage(errorMessage(error));
        }
      });
    return () => { cancelled = true; };
  }, [activeAccount?.id, hydrated, route]);

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
      if (isPayrollRoute(route) || route === '/pay/history') {
        const message = `工资功能尚未解锁。请先补全：${profileMissingRequirements(activeAccount.profile).join('、')}。`;
        queueMicrotask(() => setProfileGateMessage(message));
      }
      navigate('/profile/first-setting');
      return;
    }
    if (!profileIsReady(activeAccount.profile) && (isPayrollRoute(route) || route === '/pay/history')) {
      const message = `工资功能尚未解锁。请先补全：${profileMissingRequirements(activeAccount.profile).join('、')}。`;
      queueMicrotask(() => setProfileGateMessage(message));
      navigate('/profile/setting');
      return;
    }
    if ((isDelegatedPayrollRoute(route) || isReviewRoute(route)) && activeAccount.role === 'employee') {
      navigate('/');
      return;
    }
    if (['/staff/employees', '/audit/overview'].includes(route) && activeAccount.role === 'employee') {
      navigate('/');
      return;
    }
    if (route === '/admin/users' && activeAccount.role !== 'admin') navigate('/');
  }, [activeAccount, hydrated, route]);

  const register = async (email: string, password: string, bootstrapSecret?: string) => {
    try {
      const remote = await apiRequest<AuthResponse>('/api/users', {
        method: 'POST',
        body: { email, passwordDigest: await digestPassword(password), bootstrapSecret },
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

  const logout = async () => {
    setSystemMessage('');
    try {
      await apiRequest('/api/users/logout', { method: 'POST' });
      setActiveAccount(null);
      navigate('/account/login');
    } catch {
      setSystemMessage('登出失败，当前登录状态仍保留。请检查网络后重试。');
    }
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
      setProfileGateMessage((current) => {
        if (!current || profileIsReady(account.profile)) return '';
        return `工资功能尚未解锁。请先补全：${profileMissingRequirements(account.profile).join('、')}。`;
      });
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
    await refreshAccount().catch((error) => setSystemMessage(errorMessage(error)));
  };

  const deleteSalaryRecord = async (id: string) => {
    const record = activeAccount?.salaryRecords.find((item) => item.id === id);
    if (!record) throw new Error('该记录已不在当前列表中，请刷新后重试。');
    await apiRequest(`/api/salary-records/${id}?updatedAt=${encodeURIComponent(record.updatedAt)}`, { method: 'DELETE' });
    setActiveAccount((current) => current ? {
      ...current,
      salaryRecords: current.salaryRecords.filter((record) => record.id !== id),
    } : current);
    await refreshAccount().catch((error) => setSystemMessage(errorMessage(error)));
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
    await refreshAccount().catch((error) => setSystemMessage(errorMessage(error)));
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

  const navigateWithinApp = (nextRoute: AppRoute) => {
    if (activeAccount && (isPayrollRoute(nextRoute) || nextRoute === '/pay/history') && !profileIsReady(activeAccount.profile)) {
      setProfileGateMessage(`工资功能尚未解锁。请先补全：${profileMissingRequirements(activeAccount.profile).join('、')}。`);
    } else if (!['/profile/setting', '/profile/first-setting'].includes(nextRoute)) {
      setProfileGateMessage('');
    }
    navigate(nextRoute);
    setViewRevision((current) => current + 1);
    if (activeAccount) void refreshAccount().catch((error) => setSystemMessage(errorMessage(error)));
  };

  if (!hydrated) return <main className="app-loading"><span>正在验证账号与权限…</span></main>;

  if (!activeAccount) {
    return <AuthPage key={route} route={route} onLogin={login} onRegister={register} initialMessage={systemMessage} />;
  }

  const content = route === '/profile/first-setting' ? (
    <ProfileEditor profile={activeAccount.profile} firstTime onSave={saveProfile} onResetPassword={resetPassword} onUpload={uploadFile} />
  ) : route === '/profile/setting' ? (
    <ProfileEditor profile={activeAccount.profile} onSave={saveProfile} onResetPassword={resetPassword} onUpload={uploadFile} />
  ) : isPayrollRoute(route) ? (
    <PayrollWorkspace
      currentUserId={activeAccount.id}
      role={activeAccount.role}
      mode={route === '/pay/salary/single' ? 'single' : route === '/pay/salary/batch' ? 'batch' : 'self'}
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
  ) : route === '/review/summary' && activeAccount.role !== 'employee' ? (
    <TransferSheetWorkspace />
  ) : route === '/admin/users' && activeAccount.role === 'admin' ? (
    <AdminWorkspace currentUserId={activeAccount.id} />
  ) : route === '/staff/employees' && activeAccount.role !== 'employee' ? (
    <EmployeeWorkspace />
  ) : route === '/audit/overview' && activeAccount.role !== 'employee' ? (
    <AuditWorkspace />
  ) : (
    <LandingPage account={activeAccount} onNavigate={navigateWithinApp} />
  );

  return (
    <AppShell account={activeAccount} route={route} onNavigate={navigateWithinApp} onLogout={logout}>
      {systemMessage && <StatusMessage message={systemMessage} tone="error" />}
      {profileGateMessage && <StatusMessage message={profileGateMessage} tone="error" />}
      <div className="route-view" key={`${route}-${viewRevision}`}>{content}</div>
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
  onRegister: (email: string, password: string, bootstrapSecret?: string) => Promise<string | null>;
  initialMessage: string;
}) {
  const mode = route === '/account/register' ? 'register' : route === '/account/forget' ? 'forget' : 'login';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [bootstrapSecret, setBootstrapSecret] = useState('');
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
      setMessage('请联系管理员重置密码。');
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
    const error = mode === 'login' ? await onLogin(email, password) : await onRegister(email, password, bootstrapSecret);
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
        {mode !== 'login' && <p className="auth-card__hint">
          {mode === 'register' && (bootstrapRequired
            ? `首次使用，请为管理员账号 ${BOOTSTRAP_ADMIN_EMAIL} 设置密码。`
            : '注册后请先填写基本资料。')}
          {mode === 'forget' && '请联系管理员重置密码。'}
        </p>}
        <form
          className="auth-form"
          onSubmit={submit}
          onInvalidCapture={(event) => {
            setTone('error');
            setMessage(invalidFormControlMessage(event));
          }}
        >
          <Field label={bootstrapRequired ? '首个管理员账号' : '邮箱'} required><input type="email" maxLength={254} value={email} readOnly={bootstrapRequired} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" required /></Field>
          {mode !== 'forget' && <Field label="密码" required><input type="password" minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required /></Field>}
          {mode === 'register' && <Field label="确认密码" required><input type="password" minLength={8} maxLength={128} value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></Field>}
          {mode === 'register' && bootstrapRequired && <Field label="首次设置密钥" required><input type="password" minLength={16} maxLength={256} value={bootstrapSecret} onChange={(event) => setBootstrapSecret(event.target.value)} required /></Field>}
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
  const missingRequirements = profileMissingRequirements(account.profile);
  const privileged = account.role === 'reviewer' || account.role === 'admin';
  type NavItem = {
    route: AppRoute;
    label: string;
    icon: LucideIcon;
    children?: Array<{ route: AppRoute; label: string; icon: LucideIcon }>;
  };
  const salaryChildren: NavItem['children'] = [
    { route: '/pay/salary', label: '本人申报', icon: UserRound },
    ...(privileged ? [
      { route: '/pay/salary/single' as const, label: '他人单条申报', icon: UserPlus },
      { route: '/pay/salary/batch' as const, label: '他人多条申报', icon: CalendarRange },
    ] : []),
  ];
  const links: NavItem[] = [
    { route: '/profile/setting', label: '个人&账户信息', icon: UserRound },
    { route: '/pay/salary', label: '工资申报', icon: ClipboardList, children: privileged ? salaryChildren : undefined },
    { route: '/pay/history', label: '往期工资一览', icon: History },
  ];
  if (privileged) links.push({
    route: '/review/salary',
    label: '工资审核',
    icon: BadgeCheck,
    children: [
      { route: '/review/salary', label: '工资审批', icon: BadgeCheck },
      { route: '/review/summary', label: '工资汇总', icon: FileSpreadsheet },
    ],
  });
  if (privileged) links.push({ route: '/staff/employees', label: '员工管理', icon: UsersRound });
  if (privileged) links.push({ route: '/audit/overview', label: '总审计', icon: ChartNoAxesCombined });
  if (account.role === 'admin') links.push({ route: '/admin/users', label: '账号权限', icon: ShieldCheck });

  return (
    <main className="app-shell">
      <aside className="app-sidebar">
        <button className="brand-lockup" type="button" onClick={() => onNavigate('/')}>
          <strong><WalletCards size={19} strokeWidth={1.9} aria-hidden="true" />旅人教育</strong>
          <span>工资申报</span>
        </button>
        <nav className="app-nav" aria-label="主菜单">
          {links.map((link) => {
            const LinkIcon = link.icon;
            const linkActive = route === link.route || (route === '/profile/first-setting' && link.route === '/profile/setting');
            const groupActive = linkActive || Boolean(link.children?.some((child) => child.route === route));
            if (link.children) {
              return <div className={`app-nav__group${groupActive ? ' is-active' : ''}`} key={link.label}>
                <button
                  type="button"
                  className={`app-nav__parent${groupActive ? ' is-group-active' : ''}`}
                  onClick={() => onNavigate(link.route)}
                >
                  <LinkIcon className="nav-icon" size={17} strokeWidth={1.9} aria-hidden="true" />
                  <span>{link.label}</span>
                </button>
                <div className="app-nav__children">
                  {link.children.map((child) => {
                    const ChildIcon = child.icon;
                    const childActive = child.route === route;
                    return <button
                      key={child.route}
                      type="button"
                      className={`app-nav__child${childActive ? ' is-active' : ''}`}
                      aria-current={childActive ? 'page' : undefined}
                      onClick={() => onNavigate(child.route)}
                    >
                      <ChildIcon className="nav-icon" size={14} strokeWidth={1.9} aria-hidden="true" />
                      <span>{child.label}</span>
                    </button>;
                  })}
                </div>
              </div>;
            }
            return <button key={link.route} type="button" className={linkActive ? 'is-active' : ''} aria-current={linkActive ? 'page' : undefined} onClick={() => onNavigate(link.route)}>
              <LinkIcon className="nav-icon" size={17} strokeWidth={1.9} aria-hidden="true" />
              <span>{link.label}</span>
            </button>;
          })}
        </nav>
        <div className="account-menu">
          <span className={`role-chip role-chip--${account.role}`}>{ROLE_LABELS[account.role]}</span>
          <span title={account.email}>{name}</span>
          <button type="button" onClick={onLogout}><LogOut size={14} aria-hidden="true" />登出</button>
        </div>
      </aside>
      <section className="app-main">
        {!profileReady && (
          <aside className="profile-alert" aria-live="polite">
            <AlertTriangle size={19} aria-hidden="true" />
            <div><strong>工资申报尚未解锁</strong><span>还需补全：{missingRequirements.join('、')}。</span></div>
            <button type="button" onClick={() => onNavigate(onboardingReady ? '/profile/setting' : '/profile/first-setting')}>现在补充</button>
          </aside>
        )}
        <div className="app-content">{children}</div>
      </section>
    </main>
  );
}

function LandingPage({ account, onNavigate }: { account: StoredAccount; onNavigate: (route: AppRoute) => void }) {
  const name = `${account.profile.lastNameCn}${account.profile.firstNameCn}` || '员工';
  const actions: Array<{ label: string; description: string; route: AppRoute; number: string; icon: LucideIcon }> = [
    { number: '01', label: '个人&账户信息', description: '填写个人与收款资料', route: '/profile/setting', icon: UserRound },
    { number: '02', label: '工资申报', description: '申报并查看审核状态', route: '/pay/salary', icon: ClipboardList },
    { number: '03', label: '往期工资一览', description: '查看已通过工资', route: '/pay/history', icon: History },
  ];
  if (account.role === 'reviewer' || account.role === 'admin') {
    actions.push({ number: '04', label: '工资审核', description: '审批工资并查看工资汇总', route: '/review/salary', icon: BadgeCheck });
  }
  if (account.role === 'admin') {
    actions.push({ number: '05', label: '账号与权限', description: '管理账号、权限与部门', route: '/admin/users', icon: ShieldCheck });
  }
  if (account.role === 'reviewer' || account.role === 'admin') {
    actions.push({ number: '06', label: '员工管理', description: '查看员工资料与申报记录', route: '/staff/employees', icon: UsersRound });
    actions.push({ number: '07', label: '总审计', description: '查看月度与年度统计', route: '/audit/overview', icon: ChartNoAxesCombined });
  }

  return (
    <section className="content-card landing-card">
      <div className="landing-card__intro">
        <p className="eyebrow">工资申报</p>
        <h1>{name}，欢迎回来</h1>
      </div>
      <div className="landing-actions">
        {actions.map((action) => {
          const ActionIcon = action.icon;
          return <button type="button" className="landing-action" key={action.route} onClick={() => onNavigate(action.route)}>
            <span>{action.number}</span>
            <ActionIcon className="landing-action__icon" size={22} strokeWidth={1.7} aria-hidden="true" />
            <strong>{action.label}</strong>
            <small>{action.description}</small>
            <i aria-hidden="true"><ArrowRight size={21} /></i>
          </button>;
        })}
      </div>
    </section>
  );
}

function navigate(route: AppRoute) {
  window.location.hash = route;
}

function isPayrollRoute(route: AppRoute) {
  return route === '/pay/salary' || route === '/pay/salary/single' || route === '/pay/salary/batch';
}

function isDelegatedPayrollRoute(route: AppRoute) {
  return route === '/pay/salary/single' || route === '/pay/salary/batch';
}

function isReviewRoute(route: AppRoute) {
  return route === '/review/salary' || route === '/review/summary';
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
