ALTER TABLE `payroll_recurring_rules` ADD `submit_on_generate` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `payroll_salary_batches` ADD `payload_hash` text DEFAULT '' NOT NULL;--> statement-breakpoint

DROP INDEX IF EXISTS `payroll_salary_records_user_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_payroll_salary_user_date`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_payroll_salary_status_date`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_payroll_salary_user_date_created`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_payroll_salary_status_date_updated`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_payroll_salary_currency_status_date`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_payroll_files_user`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_payroll_audit_created`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_payroll_audit_actor`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_payroll_audit_subject_month`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_payroll_departments_active_sort`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_payroll_salary_batches_target`;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `idx_payroll_users_role_status` ON `payroll_users` (`role`, `status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_payroll_sessions_user` ON `payroll_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_payroll_sessions_expires` ON `payroll_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_payroll_salary_user_date_created` ON `payroll_salary_records` (`user_id`, `work_date` DESC, `created_at` DESC);--> statement-breakpoint
CREATE INDEX `idx_payroll_salary_status_date_updated` ON `payroll_salary_records` (`status`, `work_date` DESC, `updated_at` DESC);--> statement-breakpoint
CREATE INDEX `idx_payroll_salary_currency_status_date` ON `payroll_salary_records` (`currency`, `status`, `work_date` DESC);--> statement-breakpoint
CREATE INDEX `idx_payroll_files_user` ON `payroll_files` (`user_id`, `created_at` DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_payroll_file_refs_file` ON `payroll_file_references` (`file_key`, `reference_type`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_payroll_file_refs_reference` ON `payroll_file_references` (`reference_type`, `reference_id`);--> statement-breakpoint
CREATE INDEX `idx_payroll_audit_created` ON `payroll_audit_logs` (`created_at` DESC);--> statement-breakpoint
CREATE INDEX `idx_payroll_audit_actor` ON `payroll_audit_logs` (`actor_user_id`, `created_at` DESC);--> statement-breakpoint
CREATE INDEX `idx_payroll_audit_subject_month` ON `payroll_audit_logs` (`subject_user_id`, `business_month`, `created_at` DESC);--> statement-breakpoint
CREATE INDEX `idx_payroll_departments_active_sort` ON `payroll_departments` (`active` DESC, `sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_payroll_departments_active_label` ON `payroll_departments` (`label`) WHERE `active` = 1;--> statement-breakpoint
CREATE INDEX `idx_payroll_salary_batches_target` ON `payroll_salary_batches` (`target_user_id`, `created_at` DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_payroll_recurring_target_active` ON `payroll_recurring_rules` (`user_id`, `active`, `start_month`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_payroll_seed_entities_tag` ON `payroll_seed_entities` (`seed_tag`, `created_at`);--> statement-breakpoint

UPDATE `payroll_users`
SET `role` = 'employee'
WHERE `role` NOT IN ('employee', 'reviewer', 'admin');--> statement-breakpoint
UPDATE `payroll_users`
SET `status` = 'active'
WHERE `status` NOT IN ('active', 'disabled');--> statement-breakpoint
UPDATE `payroll_salary_records`
SET `currency` = 'JPY'
WHERE `currency` IS NULL OR `currency` NOT IN ('JPY', 'CNY');--> statement-breakpoint

INSERT OR IGNORE INTO `payroll_settings` (`key`, `value`, `updated_by`, `updated_at`)
VALUES ('registration_open', '1', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));--> statement-breakpoint

INSERT OR IGNORE INTO `payroll_departments`
  (`id`, `label`, `active`, `sort_order`, `created_at`, `updated_at`, `deleted_at`)
VALUES
  ('dept-affairs', '事务部', 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL),
  ('dept-teaching', '教学部', 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL),
  ('dept-art', '美术部', 1, 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL),
  ('dept-full-time', '正社员', 1, 3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL),
  ('dept-special', '特殊（具体备注）', 1, 4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL);--> statement-breakpoint

UPDATE `payroll_users`
SET `role` = 'admin',
    `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `id` = (SELECT `id` FROM `payroll_users` ORDER BY `created_at` LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM `payroll_users` WHERE `role` = 'admin');--> statement-breakpoint

UPDATE `payroll_users`
SET `work_manager` = 1,
    `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `id` = (
    SELECT `id`
    FROM `payroll_users`
    WHERE `role` = 'admin' AND `status` = 'active'
    ORDER BY `created_at`
    LIMIT 1
  )
  AND NOT EXISTS (SELECT 1 FROM `payroll_users` WHERE `work_manager` = 1)
  AND COALESCE((SELECT `value` FROM `payroll_settings` WHERE `key` = 'work_manager_backfilled_v1'), '') <> '1';--> statement-breakpoint
INSERT INTO `payroll_settings` (`key`, `value`, `updated_by`, `updated_at`)
VALUES ('work_manager_backfilled_v1', '1', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(`key`) DO UPDATE SET
  `value` = '1',
  `updated_at` = excluded.`updated_at`;--> statement-breakpoint

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

DELETE FROM `payroll_file_references`
WHERE (`reference_type` IN ('profile_id', 'profile_bank') AND `reference_id` IN (SELECT `id` FROM `payroll_users`))
   OR (`reference_type` = 'salary' AND `reference_id` IN (SELECT `id` FROM `payroll_salary_records`));--> statement-breakpoint

INSERT OR IGNORE INTO `payroll_file_references`
  (`file_key`, `owner_user_id`, `reference_type`, `reference_id`, `created_at`)
SELECT CAST(entry.`value` AS TEXT), user.`id`, 'profile_id', user.`id`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `payroll_users` AS user
JOIN json_each(CASE WHEN json_valid(user.`profile_json`) THEN user.`profile_json` ELSE '{}' END, '$.idFileNames') AS entry
JOIN `payroll_files` AS file ON file.`key` = CAST(entry.`value` AS TEXT) AND file.`user_id` = user.`id`
WHERE entry.`type` = 'text'
  AND CAST(entry.`value` AS TEXT) GLOB 'payroll/*'
  AND CAST(entry.`value` AS TEXT) NOT GLOB '*[^A-Za-z0-9._/-]*';--> statement-breakpoint

INSERT OR IGNORE INTO `payroll_file_references`
  (`file_key`, `owner_user_id`, `reference_type`, `reference_id`, `created_at`)
SELECT CAST(entry.`value` AS TEXT), user.`id`, 'profile_bank', user.`id`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `payroll_users` AS user
JOIN json_each(CASE WHEN json_valid(user.`profile_json`) THEN user.`profile_json` ELSE '{}' END, '$.bankFileNames') AS entry
JOIN `payroll_files` AS file ON file.`key` = CAST(entry.`value` AS TEXT) AND file.`user_id` = user.`id`
WHERE entry.`type` = 'text'
  AND CAST(entry.`value` AS TEXT) GLOB 'payroll/*'
  AND CAST(entry.`value` AS TEXT) NOT GLOB '*[^A-Za-z0-9._/-]*';--> statement-breakpoint

INSERT OR IGNORE INTO `payroll_file_references`
  (`file_key`, `owner_user_id`, `reference_type`, `reference_id`, `created_at`)
SELECT CAST(entry.`value` AS TEXT), salary.`user_id`, 'salary', salary.`id`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `payroll_salary_records` AS salary
JOIN json_each(CASE WHEN json_valid(salary.`data_json`) THEN salary.`data_json` ELSE '{}' END, '$.attachments') AS entry
JOIN `payroll_files` AS file ON file.`key` = CAST(entry.`value` AS TEXT) AND file.`user_id` = salary.`user_id`
WHERE entry.`type` = 'text'
  AND CAST(entry.`value` AS TEXT) GLOB 'payroll/*'
  AND CAST(entry.`value` AS TEXT) NOT GLOB '*[^A-Za-z0-9._/-]*';--> statement-breakpoint

INSERT INTO `payroll_settings` (`key`, `value`, `updated_by`, `updated_at`)
VALUES ('file_references_backfilled_v1', '1', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(`key`) DO UPDATE SET
  `value` = '1',
  `updated_at` = excluded.`updated_at`;--> statement-breakpoint

DELETE FROM `payroll_sessions`
WHERE length(`token`) <> 64
   OR `expires_at` <= CAST(strftime('%s', 'now') AS INTEGER) * 1000;
