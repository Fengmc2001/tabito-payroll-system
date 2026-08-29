DROP INDEX `idx_payroll_salary_user_date`;--> statement-breakpoint
DROP INDEX `idx_payroll_salary_status_date`;--> statement-breakpoint
CREATE INDEX `idx_payroll_salary_user_date_created` ON `payroll_salary_records` (`user_id`,`work_date`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_payroll_salary_status_date_updated` ON `payroll_salary_records` (`status`,`work_date`,`updated_at`);