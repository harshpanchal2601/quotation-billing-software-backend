-- Additive only. No grants, billing policy, credentials or financial backfill.
CREATE TABLE `assistant_settings` (
  `firm_id` INTEGER NOT NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `llm_enabled` BOOLEAN NOT NULL DEFAULT false,
  `daily_llm_requests` INTEGER NULL,
  `retain_content_days` INTEGER NULL,
  `updated_by_id` INTEGER NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`firm_id`),
  INDEX `assistant_setting_actor_idx` (`updated_by_id`, `firm_id`),
  CONSTRAINT `assistant_setting_firm_fk` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `assistant_setting_actor_fk` FOREIGN KEY (`updated_by_id`, `firm_id`) REFERENCES `users` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `assistant_setting_limits_check` CHECK ((`daily_llm_requests` IS NULL OR `daily_llm_requests` BETWEEN 1 AND 1000000) AND (`retain_content_days` IS NULL OR `retain_content_days` BETWEEN 1 AND 365) AND (`llm_enabled` = false OR `daily_llm_requests` IS NOT NULL))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `assistant_conversations` (
  `id` VARCHAR(36) NOT NULL, `firm_id` INTEGER NOT NULL, `actor_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `deleted_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `assistant_conversation_owner_key` (`id`, `firm_id`, `actor_id`),
  INDEX `assistant_conversation_history_idx` (`firm_id`, `actor_id`, `deleted_at`, `created_at`),
  CONSTRAINT `assistant_conversation_firm_fk` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `assistant_conversation_actor_fk` FOREIGN KEY (`actor_id`, `firm_id`) REFERENCES `users` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `assistant_messages` (
  `id` VARCHAR(36) NOT NULL, `firm_id` INTEGER NOT NULL, `actor_id` INTEGER NOT NULL,
  `conversation_id` VARCHAR(36) NOT NULL, `request_id` VARCHAR(36) NOT NULL,
  `request_hash` CHAR(64) NOT NULL, `mode` VARCHAR(10) NOT NULL, `provider` VARCHAR(40) NOT NULL,
  `model` VARCHAR(100) NULL, `tool` VARCHAR(40) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING', `error_code` VARCHAR(60) NULL,
  `input_text` VARCHAR(4000) NULL, `response` JSON NULL, `content_expires_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `assistant_message_request_key` (`firm_id`, `actor_id`, `request_id`),
  INDEX `assistant_message_conversation_idx` (`conversation_id`, `firm_id`, `actor_id`),
  INDEX `assistant_message_usage_idx` (`firm_id`, `provider`, `created_at`),
  INDEX `assistant_message_rate_idx` (`firm_id`, `created_at`),
  INDEX `assistant_message_retention_idx` (`content_expires_at`),
  CONSTRAINT `assistant_message_conversation_fk` FOREIGN KEY (`conversation_id`, `firm_id`, `actor_id`) REFERENCES `assistant_conversations` (`id`, `firm_id`, `actor_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `assistant_message_state_check` CHECK (`mode` IN ('LOCAL', 'LLM') AND `status` IN ('PENDING', 'COMPLETED', 'FAILED'))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `assistant_action_proposals` (
  `id` VARCHAR(36) NOT NULL, `firm_id` INTEGER NOT NULL, `actor_id` INTEGER NOT NULL,
  `conversation_id` VARCHAR(36) NOT NULL, `mode` VARCHAR(10) NOT NULL,
  `command` JSON NOT NULL, `evidence` JSON NOT NULL, `fingerprint` CHAR(64) NOT NULL, `nonce_hash` CHAR(64) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING', `expires_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `assistant_proposal_owner_key` (`id`, `firm_id`, `actor_id`),
  INDEX `assistant_proposal_conversation_idx` (`conversation_id`, `firm_id`, `actor_id`),
  INDEX `assistant_proposal_history_idx` (`firm_id`, `actor_id`, `status`, `created_at`),
  CONSTRAINT `assistant_proposal_conversation_fk` FOREIGN KEY (`conversation_id`, `firm_id`, `actor_id`) REFERENCES `assistant_conversations` (`id`, `firm_id`, `actor_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `assistant_proposal_state_check` CHECK (`mode` IN ('LOCAL', 'LLM') AND `status` IN ('PENDING', 'EXECUTED', 'CANCELLED'))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `assistant_executions` (
  `id` VARCHAR(36) NOT NULL, `firm_id` INTEGER NOT NULL, `actor_id` INTEGER NOT NULL,
  `proposal_id` VARCHAR(36) NOT NULL, `result` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `assistant_execution_proposal_key` (`proposal_id`),
  INDEX `assistant_execution_owner_idx` (`proposal_id`, `firm_id`, `actor_id`),
  INDEX `assistant_execution_history_idx` (`firm_id`, `actor_id`, `created_at`),
  CONSTRAINT `assistant_execution_proposal_fk` FOREIGN KEY (`proposal_id`, `firm_id`, `actor_id`) REFERENCES `assistant_action_proposals` (`id`, `firm_id`, `actor_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
