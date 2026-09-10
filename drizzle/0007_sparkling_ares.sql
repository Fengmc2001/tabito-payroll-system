CREATE TABLE `payroll_access_grants` (
	`viewer_user_id` text NOT NULL,
	`subject_user_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`viewer_user_id`, `subject_user_id`)
);
--> statement-breakpoint
CREATE TABLE `payroll_record_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`record_id` text NOT NULL,
	`actor_user_id` text,
	`action` text NOT NULL,
	`status` integer NOT NULL,
	`reviewer_user_id` text,
	`data_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_payroll_history_record` ON `payroll_record_history` (`record_id`,`id`);--> statement-breakpoint
ALTER TABLE `payroll_salary_records` ADD `reviewer_user_id` text;--> statement-breakpoint
CREATE INDEX `idx_payroll_salary_reviewer_date` ON `payroll_salary_records` (`reviewer_user_id`,`work_date`);--> statement-breakpoint
ALTER TABLE `payroll_users` ADD `features_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `payroll_users` ADD `reviewer_user_id` text;