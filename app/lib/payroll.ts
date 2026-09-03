export type AppRoute =
  | '/'
  | '/account/login'
  | '/account/register'
  | '/account/forget'
  | '/profile/first-setting'
  | '/profile/setting'
  | '/pay/salary'
  | '/pay/salary/single'
  | '/pay/salary/batch'
  | '/pay/history'
  | '/review/salary'
  | '/review/summary'
  | '/admin/users'
  | '/staff/employees'
  | '/audit/overview';

export type SalaryApplyType = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type SalaryStatus = 1 | 2 | 3 | 4;
export type AccountRole = 'employee' | 'reviewer' | 'admin';
export type AccountStatus = 'active' | 'disabled';
export type CurrencyCode = 'JPY' | 'CNY';
export type CurrencyAmounts = Record<CurrencyCode, number>;
export type SalaryRecordSource = 'self' | 'proxy-single' | 'proxy-batch' | 'recurring' | 'gray-seed';
export type PayrollBatchMode = 'fixed' | 'calendar';

export type Profile = {
  firstNameCn: string;
  lastNameCn: string;
  firstNamePinyin: string;
  lastNamePinyin: string;
  firstNameKana: string;
  lastNameKana: string;
  birthday: string;
  gender: '' | '男' | '女' | '其他';
  idType: '' | 'residence' | 'china-id' | 'passport';
  idFileNames: string[];
  nationality: string;
  idNumber: string;
  idExpiryDate: string;
  residentStatus: string;
  activityPermission: '' | '有' | '无';
  dependents: '' | '有' | '无';
  myNumber: string;
  address: string;
  addressOfLicense: string;
  tel: string;
  graduateUniversity: string;
  faculty: string;
  graduateDate: string;
  degree: string;
  bankType: '' | 'jp-bank' | 'cn-bank' | 'alipay';
  bankName: string;
  bankBranch: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
  payeeIsSelf: '' | '是' | '否';
  payeeName: string;
  payeeIdNumber: string;
  bankFileNames: string[];
};

export type SalaryRecord = {
  id: string;
  userId: string;
  workDate: string;
  checkUserId: string;
  checkUser: string;
  departmentKey: string;
  departmentLabel: string;
  currency: CurrencyCode;
  applyType: SalaryApplyType;
  workContent: string;
  memo: string;
  rate: number;
  startTime: string;
  endTime: string;
  amount: number;
  travelStart: string;
  travelEnd: string;
  travelFee: number;
  totalHours: number;
  workHours: number;
  restHours: number;
  finalSalary: number;
  attachments: string[];
  status: SalaryStatus;
  checkDate: string | null;
  auditMemo: string;
  createdByUserId: string;
  createdByName: string;
  submittedByUserId: string;
  submittedByName: string;
  source: SalaryRecordSource;
  batchId: string | null;
  recurringRuleId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StoredAccount = {
  id: string;
  email: string;
  role: AccountRole;
  status: AccountStatus;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  profile: Profile;
  salaryRecords: SalaryRecord[];
};

export type ManagedUser = {
  id: string;
  email: string;
  displayName: string;
  role: AccountRole;
  status: AccountStatus;
  workManager: boolean;
  profileReady: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

export type ManagedUserUpdateInput = {
  role?: AccountRole;
  status?: AccountStatus;
  workManager?: boolean;
  revokeSessions?: boolean;
  expectedUpdatedAt: string;
};

export type PayrollScheduleSession = {
  workDate: string;
  startTime: string;
  endTime: string;
  restHours: number;
};

export type FixedPayrollSchedule = {
  rangeStart: string;
  rangeEnd: string;
  startsAtMonthStart?: boolean;
  endsAtMonthEnd?: boolean;
  weekdays: number[];
  startTime: string;
  endTime: string;
  restHours: number;
};

export type ProxyPayrollBatchInput = {
  requestId: string;
  targetUserId: string;
  month: string;
  mode: PayrollBatchMode;
  submit: boolean;
  template: SalaryRecord;
  fixedSchedule?: FixedPayrollSchedule;
  calendarSessions?: PayrollScheduleSession[];
  recurring?: {
    enabled: boolean;
    title: string;
    startMonth: string;
    endMonth: string;
  };
};

export type RecurringPayrollRule = {
  id: string;
  userId: string;
  userDisplayName: string;
  userEmail: string;
  title: string;
  active: boolean;
  submit: boolean;
  startMonth: string;
  endMonth: string;
  template: SalaryRecord;
  schedule: FixedPayrollSchedule;
  createdByUserId: string;
  createdByName: string;
  lastRunAt: string | null;
  lastRunStatus: 'success' | 'error' | null;
  lastRunMessage: string;
  createdAt: string;
  updatedAt: string;
};

export type ReviewSalaryItem = {
  user: {
    id: string;
    email: string;
    displayName: string;
  };
  record: SalaryRecord;
};

export type AuditLogItem = {
  id: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorDisplayName: string | null;
  action: string;
  targetType: string;
  targetId: string;
  detail: Record<string, unknown>;
  createdAt: string;
};

export type DepartmentOption = {
  key: string;
  label: string;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type WorkManagerOption = {
  id: string;
  label: string;
  email: string;
};

export type StoredFileInfo = {
  key: string;
  name: string;
  contentType: string;
  size: number;
  createdAt: string;
  referenceTypes: string[];
};

export type MonthlyPayrollSummary = {
  month: string;
  recordCount: number;
  submittedAmounts: CurrencyAmounts;
  pendingAmounts: CurrencyAmounts;
  approvedAmounts: CurrencyAmounts;
  rejectedAmounts: CurrencyAmounts;
};

export type EmployeeSummary = ManagedUser & {
  recordCount: number;
  submittedAmounts: CurrencyAmounts;
  approvedAmounts: CurrencyAmounts;
};

export type EmployeeDetail = {
  user: ManagedUser;
  profile: Profile;
  files: StoredFileInfo[];
  salaryRecords: SalaryRecord[];
  monthlySummaries: MonthlyPayrollSummary[];
  auditLogs: AuditLogItem[];
};

export type TransferSheetRow = {
  user: ManagedUser;
  profile: Profile;
  approvedAmounts: CurrencyAmounts;
  pdfFiles: StoredFileInfo[];
};

export type AuditOverview = {
  year: string;
  month: string;
  monthSummary: MonthlyPayrollSummary;
  yearSummary: MonthlyPayrollSummary;
  monthlySummaries: MonthlyPayrollSummary[];
  departmentSummaries: Array<{
    departmentLabel: string;
    recordCount: number;
    submittedAmounts: CurrencyAmounts;
    approvedAmounts: CurrencyAmounts;
  }>;
  recentLogs: AuditLogItem[];
  employees: EmployeeSummary[];
  accountLogs: AuditLogItem[];
};

export const ROLE_LABELS: Record<AccountRole, string> = {
  employee: '员工',
  reviewer: '审核员',
  admin: '管理员',
};

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  active: '正常',
  disabled: '已停用',
};

export const APP_TITLE = '旅人教育入职系统';
export const BOOTSTRAP_ADMIN_EMAIL = 'TabitoAdimin01@tabitoedu.com';
export const PROFILE_TEXT_MAX_LENGTH = 500;
export const SALARY_TEXT_MAX_LENGTH = 2000;

export const APPLY_TYPES: Array<{
  value: SalaryApplyType;
  label: string;
  description: string;
}> = [
  { value: 1, label: '按时', description: '按实际工作时间与交通费计算' },
  { value: 2, label: '按件数', description: '件数 × 单价 + 交通费' },
  { value: 3, label: '按字数', description: '字数 × 单价 + 交通费' },
  { value: 4, label: '按人数', description: '人数 × 单价' },
  { value: 5, label: '仅交通费', description: '只申报交通费' },
  { value: 6, label: '定给', description: '固定金额' },
  { value: 7, label: '其他', description: '固定金额，需填写工作内容' },
];

const LEGACY_DEPARTMENTS: Array<{ key: string; label: string; applyTypes?: SalaryApplyType[] }> = [
  { key: '1-1', label: '学部 / 班主任', applyTypes: [1, 4, 6, 7] },
  { key: '1-2', label: '学部 / 小课讲师', applyTypes: [1, 6, 7] },
  { key: '1-3', label: '学部 / VIP讲师', applyTypes: [1, 7] },
  { key: '1-4', label: '学部 / 备课/过去问制作', applyTypes: [1, 2, 7] },
  { key: '1-5', label: '学部 / 试讲', applyTypes: [2, 7] },
  { key: '1-6', label: '学部 / 其他', applyTypes: [1, 2, 3, 4, 5, 6, 7] },
  { key: '1-7', label: '学部 / 正社員', applyTypes: [1, 5, 6, 7] },
  { key: '2-1', label: '小学院 / 班主任', applyTypes: [1, 4, 6, 7] },
  { key: '2-2', label: '小学院 / 小课讲师', applyTypes: [1, 6, 7] },
  { key: '2-3', label: '小学院 / VIP讲师', applyTypes: [1, 7] },
  { key: '2-4', label: '小学院 / 规划组', applyTypes: [1, 7] },
  { key: '2-5', label: '小学院 / 专业小组长', applyTypes: [4, 7] },
  { key: '2-6', label: '小学院 / 小书组', applyTypes: [1, 2, 3, 6, 7] },
  { key: '2-7', label: '小学院 / 备课/过去问制作', applyTypes: [1, 2, 7] },
  { key: '2-8', label: '小学院 / 试讲', applyTypes: [2, 7] },
  { key: '2-9', label: '小学院 / 其他', applyTypes: [1, 2, 3, 4, 5, 6, 7] },
  { key: '2-10', label: '小学院 / 正社員', applyTypes: [1, 5, 6, 7] },
  { key: '3-1', label: '市场营销 / 宣传', applyTypes: [1, 2, 3, 5, 6, 7] },
  { key: '3-2', label: '市场营销 / 业务拓展', applyTypes: [1, 2, 3, 4, 5, 6, 7] },
  { key: '3-3', label: '市场营销 / 其他', applyTypes: [1, 2, 3, 4, 5, 6, 7] },
  { key: '3-4', label: '市场营销 / 正社員', applyTypes: [1, 5, 6, 7] },
  { key: '4-1', label: '业务服务 / 教务', applyTypes: [1, 5, 7] },
  { key: '4-2', label: '业务服务 / 其他', applyTypes: [1, 2, 3, 4, 5, 6, 7] },
  { key: '4-3', label: '业务服务 / 正社員', applyTypes: [1, 5, 6, 7] },
  { key: '5-1', label: '语学类 / 托福/托业', applyTypes: [1, 7] },
  { key: '5-2', label: '语学类 / 日语', applyTypes: [1, 7] },
  { key: '5-3', label: '语学类 / 日语日语', applyTypes: [2, 7] },
  { key: '5-4', label: '语学类 / 模拟面试', applyTypes: [2, 7] },
  { key: '5-5', label: '语学类 / 其他', applyTypes: [1, 2, 3, 4, 5, 6, 7] },
  { key: '6-1', label: '其他 / 其他（慎填）', applyTypes: [1, 2, 3, 4, 5, 6, 7] },
];

export const DEFAULT_DEPARTMENTS = [
  { key: 'dept-affairs', label: '事务部' },
  { key: 'dept-teaching', label: '教学部' },
  { key: 'dept-art', label: '美术部' },
  { key: 'dept-full-time', label: '正社员' },
  { key: 'dept-special', label: '特殊（具体备注）' },
] as const;

export const CURRENCIES: Array<{ value: CurrencyCode; label: string; symbol: string }> = [
  { value: 'JPY', label: '日元', symbol: 'JP¥' },
  { value: 'CNY', label: '人民币', symbol: 'CN¥' },
];

export const emptyCurrencyAmounts = (): CurrencyAmounts => ({ JPY: 0, CNY: 0 });

export const STATUS: Record<SalaryStatus, { label: string; tone: string }> = {
  1: { label: '未提交', tone: 'draft' },
  2: { label: '待审核', tone: 'pending' },
  3: { label: '审核通过', tone: 'approved' },
  4: { label: '审核驳回', tone: 'rejected' },
};

export const createEmptyProfile = (): Profile => ({
  firstNameCn: '',
  lastNameCn: '',
  firstNamePinyin: '',
  lastNamePinyin: '',
  firstNameKana: '',
  lastNameKana: '',
  birthday: '',
  gender: '',
  idType: '',
  idFileNames: [],
  nationality: '',
  idNumber: '',
  idExpiryDate: '',
  residentStatus: '',
  activityPermission: '',
  dependents: '',
  myNumber: '',
  address: '',
  addressOfLicense: '',
  tel: '',
  graduateUniversity: '',
  faculty: '',
  graduateDate: '',
  degree: '',
  bankType: '',
  bankName: '',
  bankBranch: '',
  bankAccountNumber: '',
  bankAccountHolder: '',
  payeeIsSelf: '',
  payeeName: '',
  payeeIdNumber: '',
  bankFileNames: [],
});

export function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function currentMonth() {
  return today().slice(0, 7);
}

export function createRecord(userId: string): SalaryRecord {
  const timestamp = new Date().toISOString();
  return {
    id: makeId('salary'),
    userId,
    checkUserId: '',
    workDate: today(),
    checkUser: '',
    departmentKey: '',
    departmentLabel: '',
    currency: 'JPY',
    applyType: 1,
    workContent: '',
    memo: '',
    rate: 1000,
    startTime: '',
    endTime: '',
    amount: 0,
    travelStart: '',
    travelEnd: '',
    travelFee: 0,
    totalHours: 0,
    workHours: 0,
    restHours: 0,
    finalSalary: 0,
    attachments: [],
    status: 1,
    checkDate: null,
    auditMemo: '',
    createdByUserId: userId,
    createdByName: '',
    submittedByUserId: '',
    submittedByName: '',
    source: 'self',
    batchId: null,
    recurringRuleId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function recalculateRecord(record: SalaryRecord): SalaryRecord {
  const totalMinutes = getWorkMinutes(record.startTime, record.endTime);
  const totalHours = Number((totalMinutes / 60).toFixed(2));
  const requestedRest = numberOrZero(record.restHours);
  const restMinutes = Math.round(Math.max(0, Math.min(24, requestedRest)) * 60);
  const paidMinutes = Math.max(0, totalMinutes - restMinutes);
  const restHours = Number((restMinutes / 60).toFixed(2));
  const workHours = Number((paidMinutes / 60).toFixed(2));
  let finalSalary = 0;

  switch (record.applyType) {
    case 1:
      finalSalary = Math.floor((paidMinutes / 60) * numberOrZero(record.rate) + numberOrZero(record.travelFee));
      break;
    case 2:
    case 3:
      finalSalary = numberOrZero(record.amount) * numberOrZero(record.rate) + numberOrZero(record.travelFee);
      break;
    case 4:
      finalSalary = numberOrZero(record.amount) * numberOrZero(record.rate);
      break;
    case 5:
      finalSalary = numberOrZero(record.travelFee);
      break;
    case 6:
    case 7:
      finalSalary = numberOrZero(record.rate);
      break;
  }

  return {
    ...record,
    totalHours,
    workHours,
    restHours,
    finalSalary: Number.isFinite(finalSalary) ? Math.floor(finalSalary) : 0,
  };
}

export function getWorkHours(startTime: string, endTime: string) {
  return Number((getWorkMinutes(startTime, endTime) / 60).toFixed(2));
}

export function getWorkMinutes(startTime: string, endTime: string) {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (start === null || end === null || end <= start) return 0;
  return end - start;
}

export function formatMoney(value: number | null | undefined, currency: CurrencyCode = 'JPY') {
  const safe = Number.isFinite(value) ? Math.floor(Number(value)) : 0;
  const symbol = currency === 'CNY' ? 'CN¥' : 'JP¥';
  return `${symbol} ${safe.toLocaleString(currency === 'CNY' ? 'zh-CN' : 'ja-JP')}`;
}

export function formatYen(value: number | null | undefined) {
  return formatMoney(value, 'JPY');
}

export function getCurrencyLabel(currency: CurrencyCode) {
  return CURRENCIES.find((item) => item.value === currency)?.label ?? currency;
}

export function formatHours(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function getApplyTypeLabel(type: SalaryApplyType) {
  return APPLY_TYPES.find((item) => item.value === type)?.label ?? '-';
}

export function getDepartmentLabel(key: string, snapshot?: string) {
  return snapshot?.trim()
    || DEFAULT_DEPARTMENTS.find((item) => item.key === key)?.label
    || LEGACY_DEPARTMENTS.find((item) => item.key === key)?.label
    || '-';
}

export function profileBasicsAreReady(profile: Profile) {
  return Boolean(
    profile.lastNameCn.trim()
    && profile.firstNameCn.trim()
    && profile.address.trim()
    && profile.tel.trim(),
  );
}

export function birthdayIsValid(value: string) {
  return dateIsValid(value) && value >= '1000-01-01' && value <= today();
}

export function dateIsValid(value: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function profileMissingRequirements(profile: Profile) {
  const missing: string[] = [];
  if (!profile.lastNameCn.trim()) missing.push('中文姓');
  if (!profile.firstNameCn.trim()) missing.push('中文名');
  if (!profile.address.trim()) missing.push('现住址');
  if (!profile.tel.trim()) missing.push('联系方式');
  if (!birthdayIsValid(profile.birthday)) missing.push('生日');
  if (!profile.idType) missing.push('身份证件类型');
  if (profile.idType === 'residence' && !profile.residentStatus.trim()) missing.push('在留资格');
  if (profile.idType === 'china-id') {
    if (!profile.nationality.trim()) missing.push('国籍');
    if (!profile.idNumber.trim()) missing.push('证件号');
    if (!profile.idExpiryDate.trim()) missing.push('证件有效期限');
    if (!profile.addressOfLicense.trim()) missing.push('证件上住址所在地');
  }
  if (!profile.bankType) missing.push('工资收款方式');
  if (profile.bankFileNames.length < 1 || profile.bankFileNames.length > 2) missing.push('银行卡正反面');
  if (!profile.bankName.trim()) missing.push(profile.bankType === 'alipay' ? '支付宝账户' : '银行名称');
  if (!profile.bankAccountNumber.trim()) missing.push('收款账号');
  if (!profile.bankAccountHolder.trim()) missing.push('账户名');
  if ((profile.bankType === 'cn-bank' || profile.bankType === 'alipay') && !profile.payeeIsSelf) {
    missing.push('收款人是否本人');
  }
  if (profile.payeeIsSelf === '否' && !profile.payeeName.trim()) missing.push('收款人姓名');
  return [...new Set(missing)];
}

export function profileIsReady(profile: Profile) {
  return profileMissingRequirements(profile).length === 0;
}

export function nextPaymentDate(workDate: string) {
  const safeDate = dateIsValid(workDate) ? workDate : today();
  const [year, month] = safeDate.split('-').map(Number);
  const date = new Date(year, month, 10);
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function cloneAsDraft(record: SalaryRecord, userId: string) {
  const timestamp = new Date().toISOString();
  return recalculateRecord({
    ...record,
    id: makeId('salary'),
    userId,
    status: 1,
    checkDate: null,
    auditMemo: '',
    createdByUserId: userId,
    createdByName: '',
    submittedByUserId: '',
    submittedByName: '',
    source: 'self',
    batchId: null,
    recurringRuleId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function monthIsValid(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function mutationRequestIsSameOrigin(
  method: string,
  requestOrigin: string | null,
  targetOrigin: string,
  fetchSite: string | null,
) {
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === 'GET' || normalizedMethod === 'HEAD' || normalizedMethod === 'OPTIONS') return true;
  if (requestOrigin && requestOrigin !== targetOrigin) return false;
  const normalizedFetchSite = fetchSite?.toLowerCase();
  return normalizedFetchSite !== 'cross-site' && normalizedFetchSite !== 'same-site';
}

export function monthDateRange(month: string) {
  if (!monthIsValid(month)) return null;
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    start: `${month}-01`,
    end: `${month}-${String(lastDay).padStart(2, '0')}`,
    lastDay,
  };
}

export function expandFixedPayrollSchedule(month: string, schedule: FixedPayrollSchedule): PayrollScheduleSession[] {
  const range = monthDateRange(month);
  if (!range || !dateIsValid(schedule.rangeStart) || !dateIsValid(schedule.rangeEnd)) return [];
  if (!schedule.rangeStart.startsWith(month) || !schedule.rangeEnd.startsWith(month) || schedule.rangeStart > schedule.rangeEnd) return [];
  const weekdays = new Set(schedule.weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6));
  if (weekdays.size === 0) return [];
  const sessions: PayrollScheduleSession[] = [];
  for (let day = Number(schedule.rangeStart.slice(8, 10)); day <= Number(schedule.rangeEnd.slice(8, 10)); day += 1) {
    const workDate = `${month}-${String(day).padStart(2, '0')}`;
    if (!dateIsValid(workDate)) continue;
    const [year, monthNumber] = month.split('-').map(Number);
    if (!weekdays.has(new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay())) continue;
    sessions.push({
      workDate,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      restHours: schedule.restHours,
    });
  }
  return sessions;
}

export function makeId(prefix: string) {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 12);
  return `${prefix}-${random}`;
}

function toMinutes(value: string) {
  if (!/^([01]\d|2[0-4]):[0-5]\d$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  if (hours === 24 && minutes !== 0) return null;
  return hours * 60 + minutes;
}

function numberOrZero(value: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
