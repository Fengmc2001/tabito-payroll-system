CREATE TABLE `payroll_audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`detail_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_payroll_audit_created` ON `payroll_audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_payroll_audit_actor` ON `payroll_audit_logs` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `payroll_files` (
	`key` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`original_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_payroll_files_user` ON `payroll_files` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `payroll_salary_records` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` integer NOT NULL,
	`work_date` text NOT NULL,
	`final_salary` integer NOT NULL,
	`data_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_payroll_salary_user_date` ON `payroll_salary_records` (`user_id`,`work_date`);--> statement-breakpoint
CREATE INDEX `idx_payroll_salary_status_date` ON `payroll_salary_records` (`status`,`work_date`);--> statement-breakpoint
CREATE TABLE `payroll_sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_payroll_sessions_user` ON `payroll_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_payroll_sessions_expires` ON `payroll_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `payroll_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_by` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payroll_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_digest` text NOT NULL,
	`profile_json` text NOT NULL,
	`role` text DEFAULT 'employee' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_login_at` text,
	`failed_login_count` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payroll_users_email_unique` ON `payroll_users` (`email`);--> statement-breakpoint
CREATE INDEX `idx_payroll_users_role_status` ON `payroll_users` (`role`,`status`);