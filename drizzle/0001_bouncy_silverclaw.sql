CREATE TABLE `payroll_file_references` (
	`file_key` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`reference_type` text NOT NULL,
	`reference_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`file_key`, `reference_type`, `reference_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_payroll_file_refs_file` ON `payroll_file_references` (`file_key`,`reference_type`);--> statement-breakpoint
CREATE INDEX `idx_payroll_file_refs_reference` ON `payroll_file_references` (`reference_type`,`reference_id`);