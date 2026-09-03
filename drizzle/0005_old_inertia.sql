CREATE TABLE `payroll_recurring_instances` (
	`rule_id` text NOT NULL,
	`month` text NOT NULL,
	`record_ids_json` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`rule_id`, `month`)
);
--> statement-breakpoint
CREATE TABLE `payroll_recurring_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`start_month` text NOT NULL,
	`end_month` text DEFAULT '' NOT NULL,
	`template_json` text NOT NULL,
	`schedule_json` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`last_run_at` text,
	`last_run_status` text,
	`last_run_message` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_payroll_recurring_target_active` ON `payroll_recurring_rules` (`user_id`,`active`,`start_month`);--> statement-breakpoint
CREATE TABLE `payroll_salary_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`target_user_id` text NOT NULL,
	`record_ids_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payroll_salary_batches_request_id_unique` ON `payroll_salary_batches` (`request_id`);--> statement-breakpoint
CREATE INDEX `idx_payroll_salary_batches_target` ON `payroll_salary_batches` (`target_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `payroll_seed_entities` (
	`seed_tag` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`seed_tag`, `entity_type`, `entity_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_payroll_seed_entities_tag` ON `payroll_seed_entities` (`seed_tag`,`created_at`);--> statement-breakpoint
ALTER TABLE `payroll_audit_logs` ADD `subject_user_id` text;--> statement-breakpoint
ALTER TABLE `payroll_audit_logs` ADD `business_month` text;--> statement-breakpoint
UPDATE `payroll_audit_logs`
SET `subject_user_id` = `target_id`
WHERE `subject_user_id` IS NULL AND `target_type` = 'user';--> statement-breakpoint
UPDATE `payroll_audit_logs`
SET `subject_user_id` = (SELECT `user_id` FROM `payroll_salary_records` WHERE `id` = `payroll_audit_logs`.`target_id`),
    `business_month` = (SELECT substr(`work_date`, 1, 7) FROM `payroll_salary_records` WHERE `id` = `payroll_audit_logs`.`target_id`)
WHERE `target_type` = 'salary_record' AND (`subject_user_id` IS NULL OR `business_month` IS NULL);--> statement-breakpoint
UPDATE `payroll_audit_logs`
SET `subject_user_id` = (SELECT `target_user_id` FROM `payroll_salary_batches` WHERE `id` = `payroll_audit_logs`.`target_id`)
WHERE `target_type` = 'salary_batch' AND `subject_user_id` IS NULL;--> statement-breakpoint
UPDATE `payroll_audit_logs`
SET `subject_user_id` = (SELECT `user_id` FROM `payroll_recurring_rules` WHERE `id` = `payroll_audit_logs`.`target_id`)
WHERE `target_type` = 'recurring_rule' AND `subject_user_id` IS NULL;--> statement-breakpoint
UPDATE `payroll_audit_logs`
SET `subject_user_id` = (SELECT `user_id` FROM `payroll_files` WHERE `key` = `payroll_audit_logs`.`target_id`)
WHERE `target_type` = 'file' AND `subject_user_id` IS NULL;--> statement-breakpoint
CREATE INDEX `idx_payroll_audit_subject_month` ON `payroll_audit_logs` (`subject_user_id`,`business_month`,`created_at`);
