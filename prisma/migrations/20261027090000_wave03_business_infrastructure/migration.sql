-- Additive cutover. Stop application writers while applying this migration and
-- deploy the matching application before reopening writes. Never run mixed
-- legacy/new allocators. Existing numbers, totals and documents are untouched.
ALTER TABLE `quotations` ADD COLUMN `financial_policy_snapshot` JSON NULL;

CREATE TABLE `document_sequences` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `firm_id` INTEGER NOT NULL,
  `document_type` VARCHAR(32) NOT NULL,
  `period` VARCHAR(32) NOT NULL,
  `next_value` BIGINT NOT NULL DEFAULT 1,
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `document_sequences_firm_id_document_type_period_key` (`firm_id`, `document_type`, `period`),
  PRIMARY KEY (`id`),
  CONSTRAINT `document_sequences_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Preserve continuity even where the legacy counter was manually reduced.
-- Read all revisions and deleted rows; never recycle a historical number.
-- An out-of-range suffix deliberately fails rather than truncating a counter.
INSERT INTO `document_sequences` (`firm_id`, `document_type`, `period`, `next_value`, `updated_at`)
SELECT p.firm_id, 'QUOTATION', 'LEGACY',
  GREATEST(s.next_sequence_number, COALESCE(h.high_water, 0) + 1, 1), UTC_TIMESTAMP(3)
FROM quotation_settings s JOIN business_profiles p ON p.id = s.business_profile_id
LEFT JOIN (
  SELECT firm_id, MAX(CAST(SUBSTRING_INDEX(quotation_number, '/', -1) AS DECIMAL(50,0))) AS high_water
  FROM quotations WHERE SUBSTRING_INDEX(quotation_number, '/', -1) REGEXP '^[0-9]+$'
  GROUP BY firm_id
) h ON h.firm_id = p.firm_id;

CREATE TABLE `firm_business_policies` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `firm_id` INTEGER NOT NULL,
  `version` INTEGER NOT NULL,
  `policy` JSON NOT NULL,
  `actor_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `firm_business_policies_firm_id_version_key` (`firm_id`, `version`),
  PRIMARY KEY (`id`),
  CONSTRAINT `firm_business_policies_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `outbox_events` (
  `id` VARCHAR(36) NOT NULL,
  `firm_id` INTEGER NOT NULL,
  `actor_id` INTEGER NOT NULL,
  `kind` VARCHAR(100) NOT NULL,
  `source_event_id` VARCHAR(191) NOT NULL,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `payload` JSON NOT NULL,
  `status` ENUM('PENDING','PROCESSING','SUCCEEDED','DEAD','RECONCILE') NOT NULL DEFAULT 'PENDING',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `max_attempts` INTEGER NOT NULL DEFAULT 5,
  `available_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `locked_until` DATETIME(3) NULL,
  `lock_token` VARCHAR(36) NULL,
  `completed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `outbox_events_firm_id_idempotency_key_key` (`firm_id`, `idempotency_key`),
  UNIQUE INDEX `outbox_events_id_firm_id_key` (`id`, `firm_id`),
  INDEX `outbox_events_status_available_at_idx` (`status`, `available_at`),
  INDEX `outbox_events_status_locked_until_idx` (`status`, `locked_until`),
  PRIMARY KEY (`id`),
  CONSTRAINT `outbox_events_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `job_attempts` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `event_id` VARCHAR(36) NOT NULL,
  `attempt` INTEGER NOT NULL,
  `worker_id` VARCHAR(100) NOT NULL,
  `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finished_at` DATETIME(3) NULL,
  `outcome` VARCHAR(32) NULL,
  `error_code` VARCHAR(100) NULL,
  UNIQUE INDEX `job_attempts_event_id_attempt_key` (`event_id`, `attempt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `job_attempts_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `outbox_events` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `notification_preferences` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `firm_id` INTEGER NOT NULL,
  `channel` VARCHAR(20) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  UNIQUE INDEX `notification_preferences_firm_id_channel_key` (`firm_id`, `channel`),
  PRIMARY KEY (`id`),
  CONSTRAINT `notification_preferences_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `notification_deliveries` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `firm_id` INTEGER NOT NULL,
  `event_id` VARCHAR(36) NOT NULL,
  `recipient_id` INTEGER NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `body` TEXT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `notification_deliveries_event_id_recipient_id_key` (`event_id`, `recipient_id`),
  INDEX `notification_deliveries_firm_id_recipient_id_created_at_idx` (`firm_id`, `recipient_id`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `notification_deliveries_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `notification_deliveries_event_id_firm_id_fkey` FOREIGN KEY (`event_id`, `firm_id`) REFERENCES `outbox_events` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
