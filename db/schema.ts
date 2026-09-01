import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Runtime initialization lives in app/lib/server/payroll-store.ts so local
// previews and deployed D1 bindings share the same schema. These definitions
// keep the schema inspectable and ready for conventional Drizzle migrations.
export const payrollUsers = sqliteTable('payroll_users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordDigest: text('password_digest').notNull(),
  profileJson: text('profile_json').notNull(),
  role: text('role', { enum: ['employee', 'reviewer', 'admin'] }).notNull().default('employee'),
  status: text('status', { enum: ['active', 'disabled'] }).notNull().default('active'),
  lastLoginAt: text('last_login_at'),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: integer('locked_until'),
  workManager: integer('work_manager', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_payroll_users_role_status').on(table.role, table.status),
]);

export const payrollSessions = sqliteTable('payroll_sessions', {
  token: text('token').primaryKey(),
  userId: text('user_id').notNull(),
  expiresAt: integer('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_payroll_sessions_user').on(table.userId),
  index('idx_payroll_sessions_expires').on(table.expiresAt),
]);

export const payrollSalaryRecords = sqliteTable('payroll_salary_records', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  status: integer('status').notNull(),
  workDate: text('work_date').notNull(),
  finalSalary: integer('final_salary').notNull(),
  currency: text('currency', { enum: ['JPY', 'CNY'] }).notNull().default('JPY'),
  dataJson: text('data_json').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_payroll_salary_user_date_created').on(table.userId, table.workDate, table.createdAt),
  index('idx_payroll_salary_status_date_updated').on(table.status, table.workDate, table.updatedAt),
  index('idx_payroll_salary_currency_status_date').on(table.currency, table.status, table.workDate),
]);

export const payrollDepartments = sqliteTable('payroll_departments', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
}, (table) => [
  index('idx_payroll_departments_active_sort').on(table.active, table.sortOrder),
]);

export const payrollFiles = sqliteTable('payroll_files', {
  key: text('key').primaryKey(),
  userId: text('user_id').notNull(),
  originalName: text('original_name').notNull(),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_payroll_files_user').on(table.userId, table.createdAt),
]);

export const payrollFileReferences = sqliteTable('payroll_file_references', {
  fileKey: text('file_key').notNull(),
  ownerUserId: text('owner_user_id').notNull(),
  referenceType: text('reference_type', { enum: ['profile_id', 'profile_bank', 'salary'] }).notNull(),
  referenceId: text('reference_id').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.fileKey, table.referenceType, table.referenceId] }),
  index('idx_payroll_file_refs_file').on(table.fileKey, table.referenceType),
  index('idx_payroll_file_refs_reference').on(table.referenceType, table.referenceId),
]);

export const payrollSettings = sqliteTable('payroll_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedBy: text('updated_by'),
  updatedAt: text('updated_at').notNull(),
});

export const payrollAuditLogs = sqliteTable('payroll_audit_logs', {
  id: text('id').primaryKey(),
  actorUserId: text('actor_user_id'),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  detailJson: text('detail_json').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_payroll_audit_created').on(table.createdAt),
  index('idx_payroll_audit_actor').on(table.actorUserId, table.createdAt),
]);
