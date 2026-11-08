-- Additive Wave 08 schema. No historical financial rows are changed.
ALTER TABLE `outbox_events` ADD COLUMN `correlation_id` VARCHAR(191) NULL,
  ADD INDEX `outbox_firm_correlation_idx` (`firm_id`, `correlation_id`);

CREATE TABLE `automation_definition_versions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `firm_id` INTEGER NOT NULL,
  `kind` VARCHAR(20) NOT NULL, `key` VARCHAR(64) NOT NULL, `version` INTEGER NOT NULL,
  `definition` JSON NOT NULL, `published_by_id` INTEGER NOT NULL,
  `published_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), UNIQUE INDEX `automation_version_id_firm_key` (`id`, `firm_id`),
  UNIQUE INDEX `automation_version_identity_key` (`firm_id`, `kind`, `key`, `version`),
  INDEX `automation_publisher_idx` (`published_by_id`, `firm_id`),
  CONSTRAINT `automation_version_kind_check` CHECK (`kind` IN ('WORKFLOW','APPROVAL','TEMPLATE','CUSTOM_FIELDS','NOTIFICATION')),
  CONSTRAINT `automation_version_positive_check` CHECK (`version` > 0),
  CONSTRAINT `automation_version_firm_fk` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `automation_version_publisher_fk` FOREIGN KEY (`published_by_id`, `firm_id`) REFERENCES `users` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `workflow_runs` (
  `id` VARCHAR(36) NOT NULL, `firm_id` INTEGER NOT NULL, `definition_id` INTEGER NOT NULL,
  `source_event_id` VARCHAR(191) NOT NULL, `actor_id` INTEGER NOT NULL, `event` JSON NOT NULL,
  `outbox_id` VARCHAR(36) NOT NULL, `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `reason` VARCHAR(100) NULL, `expires_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `completed_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `workflow_run_id_firm_key` (`id`, `firm_id`),
  UNIQUE INDEX `workflow_runs_outbox_firm_key` (`outbox_id`, `firm_id`),
  UNIQUE INDEX `workflow_run_event_key` (`firm_id`, `definition_id`, `source_event_id`),
  INDEX `workflow_runs_firm_created_idx` (`firm_id`, `created_at`),
  INDEX `workflow_run_definition_idx` (`definition_id`, `firm_id`),
  INDEX `workflow_run_actor_idx` (`actor_id`, `firm_id`),
  CONSTRAINT `workflow_run_status_check` CHECK (`status` IN ('PENDING','SUCCEEDED','CANCELLED','EXPIRED')),
  CONSTRAINT `workflow_run_firm_fk` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `workflow_run_definition_fk` FOREIGN KEY (`definition_id`, `firm_id`) REFERENCES `automation_definition_versions` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `workflow_run_outbox_fk` FOREIGN KEY (`outbox_id`, `firm_id`) REFERENCES `outbox_events` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `workflow_run_actor_fk` FOREIGN KEY (`actor_id`, `firm_id`) REFERENCES `users` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `workflow_action_results` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `firm_id` INTEGER NOT NULL, `run_id` VARCHAR(36) NOT NULL,
  `step` VARCHAR(32) NOT NULL, `outcome` VARCHAR(32) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE INDEX `workflow_action_results_run_id_step_key` (`run_id`, `step`),
  INDEX `workflow_action_results_run_id_firm_id_idx` (`run_id`, `firm_id`),
  CONSTRAINT `workflow_action_run_fk` FOREIGN KEY (`run_id`, `firm_id`) REFERENCES `workflow_runs` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `approval_requests` (
  `id` VARCHAR(36) NOT NULL, `firm_id` INTEGER NOT NULL, `policy_id` INTEGER NOT NULL,
  `requester_id` INTEGER NOT NULL, `fingerprint` CHAR(64) NOT NULL, `command` JSON NOT NULL, `evidence` JSON NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING', `expires_at` DATETIME(3) NOT NULL, `consumed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE INDEX `approval_requests_id_firm_id_key` (`id`, `firm_id`),
  INDEX `approval_request_fingerprint_idx` (`firm_id`, `requester_id`, `fingerprint`, `status`),
  INDEX `approval_request_policy_idx` (`policy_id`, `firm_id`),
  INDEX `approval_request_actor_idx` (`requester_id`, `firm_id`),
  CONSTRAINT `approval_request_status_check` CHECK (`status` IN ('PENDING','APPROVED','REJECTED','REVOKED','CANCELLED')),
  CONSTRAINT `approval_request_firm_fk` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `approval_request_policy_fk` FOREIGN KEY (`policy_id`, `firm_id`) REFERENCES `automation_definition_versions` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `approval_request_actor_fk` FOREIGN KEY (`requester_id`, `firm_id`) REFERENCES `users` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `approval_decisions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `firm_id` INTEGER NOT NULL, `request_id` VARCHAR(36) NOT NULL,
  `actor_id` INTEGER NOT NULL, `decision` VARCHAR(20) NOT NULL, `reason` VARCHAR(2000) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  INDEX `approval_decisions_request_id_firm_id_idx` (`request_id`, `firm_id`),
  INDEX `approval_decision_actor_idx` (`actor_id`, `firm_id`),
  CONSTRAINT `approval_decision_value_check` CHECK (`decision` IN ('APPROVED','REJECTED','REVOKED','CANCELLED')),
  CONSTRAINT `approval_decision_request_fk` FOREIGN KEY (`request_id`, `firm_id`) REFERENCES `approval_requests` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `approval_decision_actor_fk` FOREIGN KEY (`actor_id`, `firm_id`) REFERENCES `users` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `custom_field_value_versions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `firm_id` INTEGER NOT NULL, `entity` VARCHAR(20) NOT NULL, `entity_id` INTEGER NOT NULL,
  `definition_id` INTEGER NULL, `schema_snapshot` JSON NULL, `version` INTEGER NOT NULL, `values` JSON NOT NULL, `actor_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE INDEX `custom_field_value_identity_key` (`firm_id`, `entity`, `entity_id`, `version`),
  INDEX `custom_field_value_definition_idx` (`definition_id`, `firm_id`),
  INDEX `custom_field_value_actor_idx` (`actor_id`, `firm_id`),
  CONSTRAINT `custom_field_value_entity_check` CHECK (`entity` IN ('COMPANY','ITEM','QUOTATION','INVOICE')),
  CONSTRAINT `custom_field_value_schema_check` CHECK ((`entity` = 'INVOICE' AND `schema_snapshot` IS NOT NULL) OR (`entity` <> 'INVOICE' AND `definition_id` IS NOT NULL)),
  CONSTRAINT `custom_field_value_version_check` CHECK (`version` > 0),
  CONSTRAINT `custom_field_value_firm_fk` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `custom_field_value_definition_fk` FOREIGN KEY (`definition_id`, `firm_id`) REFERENCES `automation_definition_versions` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `custom_field_value_actor_fk` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `automation_recipient_preferences` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `firm_id` INTEGER NOT NULL, `user_id` INTEGER NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT false, `utc_offset_minutes` INTEGER NOT NULL DEFAULT 0,
  `quiet_start_minute` INTEGER NULL, `quiet_end_minute` INTEGER NULL, `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `automation_recipient_preferences_firm_id_user_id_key` (`firm_id`, `user_id`),
  INDEX `automation_recipient_preferences_user_id_firm_id_idx` (`user_id`, `firm_id`),
  CONSTRAINT `automation_preference_offset_check` CHECK (`utc_offset_minutes` BETWEEN -720 AND 840),
  CONSTRAINT `automation_preference_quiet_check` CHECK ((`quiet_start_minute` IS NULL AND `quiet_end_minute` IS NULL) OR (`quiet_start_minute` IS NOT NULL AND `quiet_end_minute` IS NOT NULL AND `quiet_start_minute` BETWEEN 0 AND 1439 AND `quiet_end_minute` BETWEEN 0 AND 1439 AND `quiet_start_minute` <> `quiet_end_minute`)),
  CONSTRAINT `automation_preference_firm_fk` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `automation_preference_user_fk` FOREIGN KEY (`user_id`, `firm_id`) REFERENCES `users` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Existing quotation revisions start without a tenant template. First generation
-- pins an explicit snapshot; subsequent configuration publication cannot change it.
ALTER TABLE `quotations` ADD COLUMN `automation_presentation_snapshot` JSON NULL;
-- Unknown historical PDF contents are never inferred or backfilled.
ALTER TABLE `generated_documents` ADD COLUMN `source_snapshot_hash` CHAR(64) NULL;

-- DB-level immutability complements the append-only repository APIs.
CREATE TRIGGER `automation_versions_no_update` BEFORE UPDATE ON `automation_definition_versions`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Published automation versions are immutable';
CREATE TRIGGER `approval_decisions_no_update` BEFORE UPDATE ON `approval_decisions`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Approval decisions are immutable';
CREATE TRIGGER `custom_field_values_no_update` BEFORE UPDATE ON `custom_field_value_versions`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Custom field value versions are immutable';
