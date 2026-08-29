CREATE TABLE `payroll_departments` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_payroll_departments_active_sort` ON `payroll_departments` (`active`,`sort_order`);--> statement-breakpoint
ALTER TABLE `payroll_salary_records` ADD `currency` text DEFAULT 'JPY' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_payroll_salary_currency_status_date` ON `payroll_salary_records` (`currency`,`status`,`work_date`);