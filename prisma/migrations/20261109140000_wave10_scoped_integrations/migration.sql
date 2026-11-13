CREATE TABLE `api_keys` (
  `id` VARCHAR(36) NOT NULL, `firm_id` INTEGER NOT NULL, `actor_id` INTEGER NOT NULL,
  `name` VARCHAR(100) NOT NULL, `token_hash` CHAR(64) NOT NULL, `scopes` JSON NOT NULL,
  `expires_at` DATETIME(3) NOT NULL, `revoked_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), UNIQUE INDEX `api_keys_token_hash_key` (`token_hash`),
  INDEX `api_keys_firm_id_created_at_idx` (`firm_id`, `created_at`),
  CONSTRAINT `api_keys_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `api_keys_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `webhook_endpoints` (
  `id` VARCHAR(36) NOT NULL, `firm_id` INTEGER NOT NULL, `actor_id` INTEGER NOT NULL,
  `name` VARCHAR(100) NOT NULL, `url` VARCHAR(1000) NOT NULL, `enabled` BOOLEAN NOT NULL DEFAULT false,
  `secret_version` INTEGER NOT NULL DEFAULT 1, `encrypted_secret` TEXT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), UNIQUE INDEX `webhook_endpoints_id_firm_id_key` (`id`, `firm_id`),
  INDEX `webhook_endpoints_firm_id_enabled_idx` (`firm_id`, `enabled`),
  CONSTRAINT `webhook_endpoints_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `webhook_endpoints_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK (`secret_version` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `webhook_deliveries` (
  `id` VARCHAR(36) NOT NULL, `firm_id` INTEGER NOT NULL, `endpoint_id` VARCHAR(36) NOT NULL,
  `outbox_event_id` VARCHAR(36) NOT NULL, `source_event_id` VARCHAR(36) NOT NULL,
  `secret_version` INTEGER NOT NULL, `encrypted_secret` TEXT NOT NULL, `body` TEXT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), UNIQUE INDEX `webhook_deliveries_outbox_event_id_firm_id_key` (`outbox_event_id`, `firm_id`),
  UNIQUE INDEX `webhook_deliveries_endpoint_id_source_event_id_key` (`endpoint_id`, `source_event_id`),
  INDEX `webhook_deliveries_firm_id_created_at_idx` (`firm_id`, `created_at`),
  INDEX `webhook_deliveries_endpoint_id_firm_id_idx` (`endpoint_id`, `firm_id`),
  CONSTRAINT `webhook_deliveries_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `webhook_deliveries_endpoint_id_firm_id_fkey` FOREIGN KEY (`endpoint_id`, `firm_id`) REFERENCES `webhook_endpoints` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `webhook_deliveries_outbox_event_id_firm_id_fkey` FOREIGN KEY (`outbox_event_id`, `firm_id`) REFERENCES `outbox_events` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (`secret_version` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
