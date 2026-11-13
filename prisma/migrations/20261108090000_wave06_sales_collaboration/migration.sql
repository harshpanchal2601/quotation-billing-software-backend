-- Additive Wave 06. No financial records are backfilled or rewritten.
-- Review/apply only to a disposable MySQL database before rollout.
ALTER TABLE `invoices` ADD COLUMN `source_sales_order_id` INTEGER NULL;
CREATE INDEX `invoices_firm_id_source_sales_order_id_status_idx` ON `invoices` (`firm_id`, `source_sales_order_id`, `status`);
ALTER TABLE `quotation_status_history` MODIFY `changed_by_id` INTEGER NULL, ADD COLUMN `portal_actor_name` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `users_id_firm_id_key` ON `users` (`id`, `firm_id`);
CREATE UNIQUE INDEX `company_contacts_id_company_id_key` ON `company_contacts` (`id`, `company_id`);
CREATE UNIQUE INDEX `quotations_id_firm_id_company_id_key` ON `quotations` (`id`, `firm_id`, `company_id`);
CREATE UNIQUE INDEX `invoices_id_firm_id_company_id_key` ON `invoices` (`id`, `firm_id`, `company_id`);
CREATE UNIQUE INDEX `invoices_id_firm_id_source_sales_order_id_key` ON `invoices` (`id`, `firm_id`, `source_sales_order_id`);

CREATE TABLE `leads` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  `firm_id` INTEGER NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NULL,
  `phone` VARCHAR(30) NULL,
  `source` VARCHAR(191) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'NEW',
  `company_id` INTEGER NULL,
  `owner_id` INTEGER NOT NULL,
  `created_by_id` INTEGER NOT NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `conversion_key` VARCHAR(100) NULL,
  `conversion_hash` CHAR(64) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `leads_id_firm_id_key` (`id`, `firm_id`),
  UNIQUE INDEX `leads_firm_id_conversion_key_key` (`firm_id`, `conversion_key`),
  INDEX `leads_firm_id_owner_id_id_idx` (`firm_id`, `owner_id`, `id`),
  INDEX `leads_company_id_firm_id_idx` (`company_id`, `firm_id`),
  CONSTRAINT `leads_check_1` CHECK (`status` IN ('NEW','QUALIFIED','CONVERTED','CLOSED')),
  CONSTRAINT `leads_check_2` CHECK (`version` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `opportunities` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  `firm_id` INTEGER NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `stage` VARCHAR(30) NOT NULL,
  `probability` INTEGER NOT NULL,
  `value` DECIMAL(24,3) NOT NULL,
  `currency` VARCHAR(3) NOT NULL,
  `owner_id` INTEGER NOT NULL,
  `created_by_id` INTEGER NOT NULL,
  `expected_close` DATE NULL,
  `company_id` INTEGER NULL,
  `lead_id` INTEGER NULL,
  `quotation_id` INTEGER NULL,
  `source` VARCHAR(191) NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `opportunities_id_firm_id_key` (`id`, `firm_id`),
  INDEX `opportunities_firm_id_stage_id_idx` (`firm_id`, `stage`, `id`),
  INDEX `opportunities_firm_id_owner_id_id_idx` (`firm_id`, `owner_id`, `id`),
  INDEX `opportunities_company_id_firm_id_idx` (`company_id`, `firm_id`),
  CONSTRAINT `opportunities_check_1` CHECK (`stage` IN ('NEW','QUALIFIED','PROPOSAL','NEGOTIATION','WON','LOST')),
  CONSTRAINT `opportunities_check_2` CHECK (`probability` BETWEEN 0 AND 100),
  CONSTRAINT `opportunities_check_3` CHECK (`value` >= 0),
  CONSTRAINT `opportunities_check_4` CHECK (`version` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sales_tasks` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  `firm_id` INTEGER NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `notes` TEXT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  `assigned_to_id` INTEGER NOT NULL,
  `created_by_id` INTEGER NOT NULL,
  `due_at` DATETIME(3) NOT NULL,
  `reminder_at` DATETIME(3) NULL,
  `company_id` INTEGER NULL,
  `lead_id` INTEGER NULL,
  `opportunity_id` INTEGER NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `sales_tasks_id_firm_id_key` (`id`, `firm_id`),
  INDEX `sales_tasks_firm_id_assigned_to_id_status_due_at_idx` (`firm_id`, `assigned_to_id`, `status`, `due_at`),
  INDEX `sales_tasks_company_id_firm_id_idx` (`company_id`, `firm_id`),
  CONSTRAINT `sales_tasks_check_1` CHECK (`status` IN ('OPEN','DONE','CANCELLED')),
  CONSTRAINT `sales_tasks_check_2` CHECK (`version` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sales_activities` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  `firm_id` INTEGER NOT NULL,
  `company_id` INTEGER NULL,
  `lead_id` INTEGER NULL,
  `opportunity_id` INTEGER NULL,
  `task_id` INTEGER NULL,
  `kind` VARCHAR(30) NOT NULL,
  `subject` VARCHAR(191) NOT NULL,
  `notes` TEXT NULL,
  `details` JSON NULL,
  `created_by_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `sales_activities_firm_id_company_id_id_idx` (`firm_id`, `company_id`, `id`),
  INDEX `sales_activities_lead_id_firm_id_idx` (`lead_id`, `firm_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sales_orders` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  `firm_id` INTEGER NOT NULL,
  `company_id` INTEGER NOT NULL,
  `source_quotation_id` INTEGER NOT NULL,
  `order_number` VARCHAR(50) NOT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  `version` INTEGER NOT NULL DEFAULT 1,
  `currency` VARCHAR(3) NOT NULL,
  `snapshot` JSON NOT NULL,
  `snapshot_hash` CHAR(64) NOT NULL,
  `idempotency_key` VARCHAR(100) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `created_by_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `sales_orders_id_firm_id_key` (`id`, `firm_id`),
  UNIQUE INDEX `sales_orders_id_firm_id_company_id_key` (`id`, `firm_id`, `company_id`),
  UNIQUE INDEX `sales_orders_firm_id_source_quotation_id_key` (`firm_id`, `source_quotation_id`),
  UNIQUE INDEX `sales_orders_firm_id_idempotency_key_key` (`firm_id`, `idempotency_key`),
  UNIQUE INDEX `sales_orders_firm_id_order_number_key` (`firm_id`, `order_number`),
  INDEX `sales_orders_firm_id_status_id_idx` (`firm_id`, `status`, `id`),
  INDEX `sales_orders_company_id_firm_id_idx` (`company_id`, `firm_id`),
  CONSTRAINT `sales_orders_check_1` CHECK (`status` IN ('OPEN','PARTIALLY_FULFILLED','FULFILLED','CANCELLED')),
  CONSTRAINT `sales_orders_check_2` CHECK (`version` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sales_order_lines` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  `firm_id` INTEGER NOT NULL,
  `sales_order_id` INTEGER NOT NULL,
  `line_number` INTEGER NOT NULL,
  `quantity` DECIMAL(18,3) NOT NULL,
  `snapshot` JSON NOT NULL,
  UNIQUE INDEX `sales_order_lines_id_firm_id_sales_order_id_key` (`id`, `firm_id`, `sales_order_id`),
  UNIQUE INDEX `sales_order_lines_sales_order_id_line_number_key` (`sales_order_id`, `line_number`),
  CONSTRAINT `sales_order_lines_check_1` CHECK (`quantity` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `fulfillments` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  `firm_id` INTEGER NOT NULL,
  `sales_order_id` INTEGER NOT NULL,
  `reference` VARCHAR(191) NOT NULL,
  `occurred_at` DATETIME(3) NOT NULL,
  `idempotency_key` VARCHAR(100) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `created_by_id` INTEGER NOT NULL,
  `cancelled_at` DATETIME(3) NULL,
  `cancellation_reason` TEXT NULL,
  `cancelled_by_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `fulfillments_id_firm_id_sales_order_id_key` (`id`, `firm_id`, `sales_order_id`),
  UNIQUE INDEX `fulfillments_firm_id_idempotency_key_key` (`firm_id`, `idempotency_key`),
  INDEX `fulfillments_firm_id_sales_order_id_id_idx` (`firm_id`, `sales_order_id`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `fulfillment_lines` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  `firm_id` INTEGER NOT NULL,
  `sales_order_id` INTEGER NOT NULL,
  `fulfillment_id` INTEGER NOT NULL,
  `sales_order_line_id` INTEGER NOT NULL,
  `quantity` DECIMAL(18,3) NOT NULL,
  UNIQUE INDEX `fulfillment_lines_fulfillment_id_sales_order_line_id_key` (`fulfillment_id`, `sales_order_line_id`),
  INDEX `fulfillment_lines_firm_id_sales_order_line_id_idx` (`firm_id`, `sales_order_line_id`),
  CONSTRAINT `fulfillment_lines_check_1` CHECK (`quantity` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sales_order_invoice_lines` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  `firm_id` INTEGER NOT NULL,
  `sales_order_id` INTEGER NOT NULL,
  `sales_order_line_id` INTEGER NOT NULL,
  `invoice_id` INTEGER NOT NULL,
  `quantity` DECIMAL(18,3) NOT NULL,
  UNIQUE INDEX `sales_order_invoice_lines_invoice_id_sales_order_line_id_key` (`invoice_id`, `sales_order_line_id`),
  INDEX `sales_order_invoice_lines_firm_id_sales_order_id_idx` (`firm_id`, `sales_order_id`),
  CONSTRAINT `sales_order_invoice_lines_check_1` CHECK (`quantity` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sales_order_history` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  `firm_id` INTEGER NOT NULL,
  `sales_order_id` INTEGER NOT NULL,
  `version` INTEGER NOT NULL,
  `status` VARCHAR(30) NOT NULL,
  `actor_id` INTEGER NOT NULL,
  `reason` VARCHAR(2000) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `sales_order_history_sales_order_id_version_key` (`sales_order_id`, `version`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `portal_identities` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  `firm_id` INTEGER NOT NULL,
  `company_id` INTEGER NOT NULL,
  `contact_id` INTEGER NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `revoked_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `portal_identities_id_firm_id_company_id_key` (`id`, `firm_id`, `company_id`),
  UNIQUE INDEX `portal_identities_firm_id_contact_id_key` (`firm_id`, `contact_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `portal_invitations` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  `firm_id` INTEGER NOT NULL,
  `company_id` INTEGER NOT NULL,
  `identity_id` INTEGER NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  UNIQUE INDEX `portal_invitations_token_hash_key` (`token_hash`),
  `expires_at` DATETIME(3) NOT NULL,
  `consumed_at` DATETIME(3) NULL,
  `revoked_at` DATETIME(3) NULL,
  `created_by_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `portal_invitations_id_firm_id_company_id_identity_id_key` (`id`, `firm_id`, `company_id`, `identity_id`),
  INDEX `portal_invitations_firm_id_identity_id_idx` (`firm_id`, `identity_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `portal_sessions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  `firm_id` INTEGER NOT NULL,
  `company_id` INTEGER NOT NULL,
  `identity_id` INTEGER NOT NULL,
  `invitation_id` INTEGER NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  UNIQUE INDEX `portal_sessions_token_hash_key` (`token_hash`),
  `csrf_hash` CHAR(64) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `revoked_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `portal_sessions_id_firm_id_company_id_identity_id_key` (`id`, `firm_id`, `company_id`, `identity_id`),
  INDEX `portal_sessions_firm_id_identity_id_idx` (`firm_id`, `identity_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `portal_grants` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  `firm_id` INTEGER NOT NULL,
  `company_id` INTEGER NOT NULL,
  `identity_id` INTEGER NOT NULL,
  `quotation_id` INTEGER NULL,
  `invoice_id` INTEGER NULL,
  `sales_order_id` INTEGER NULL,
  `snapshot` JSON NOT NULL,
  `snapshot_hash` CHAR(64) NOT NULL,
  `allow_decision` BOOLEAN NOT NULL DEFAULT FALSE,
  `expires_at` DATETIME(3) NOT NULL,
  `revoked_at` DATETIME(3) NULL,
  `created_by_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `portal_grants_id_firm_id_company_id_key` (`id`, `firm_id`, `company_id`),
  UNIQUE INDEX `portal_grants_id_firm_id_company_id_identity_id_key` (`id`, `firm_id`, `company_id`, `identity_id`),
  INDEX `portal_grants_firm_id_identity_id_id_idx` (`firm_id`, `identity_id`, `id`),
  CONSTRAINT `portal_grants_check_1` CHECK (((`quotation_id` IS NOT NULL) + (`invoice_id` IS NOT NULL) + (`sales_order_id` IS NOT NULL)) = 1),
  CONSTRAINT `portal_grants_check_2` CHECK ((`allow_decision` = FALSE OR `quotation_id` IS NOT NULL))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `document_acceptances` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  `firm_id` INTEGER NOT NULL,
  `company_id` INTEGER NOT NULL,
  `quotation_id` INTEGER NOT NULL,
  `revision_number` INTEGER NOT NULL,
  `grant_id` INTEGER NOT NULL,
  `identity_id` INTEGER NOT NULL,
  `session_id` INTEGER NOT NULL,
  `decision` VARCHAR(20) NOT NULL,
  `snapshot_hash` CHAR(64) NOT NULL,
  `actor_name` VARCHAR(191) NOT NULL,
  `actor_email` VARCHAR(191) NOT NULL,
  `consent` TEXT NOT NULL,
  `ip_address` VARCHAR(191) NULL,
  `user_agent` TEXT NULL,
  `idempotency_key` VARCHAR(100) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `document_acceptances_firm_id_quotation_id_key` (`firm_id`, `quotation_id`),
  UNIQUE INDEX `document_acceptances_firm_id_idempotency_key_key` (`firm_id`, `idempotency_key`),
  CONSTRAINT `document_acceptances_check_1` CHECK (`decision` IN ('ACCEPTED','REJECTED'))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `leads` ADD CONSTRAINT `leads_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `leads` ADD CONSTRAINT `leads_company_id_firm_id_fkey` FOREIGN KEY (`company_id`, `firm_id`) REFERENCES `companies` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `leads` ADD CONSTRAINT `leads_owner_id_firm_id_fkey` FOREIGN KEY (`owner_id`, `firm_id`) REFERENCES `users` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `leads` ADD CONSTRAINT `leads_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `opportunities` ADD CONSTRAINT `opportunities_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `opportunities` ADD CONSTRAINT `opportunities_company_id_firm_id_fkey` FOREIGN KEY (`company_id`, `firm_id`) REFERENCES `companies` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `opportunities` ADD CONSTRAINT `opportunities_lead_id_firm_id_fkey` FOREIGN KEY (`lead_id`, `firm_id`) REFERENCES `leads` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `opportunities` ADD CONSTRAINT `opportunities_quotation_id_firm_id_fkey` FOREIGN KEY (`quotation_id`, `firm_id`) REFERENCES `quotations` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `opportunities` ADD CONSTRAINT `opportunities_owner_id_firm_id_fkey` FOREIGN KEY (`owner_id`, `firm_id`) REFERENCES `users` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `opportunities` ADD CONSTRAINT `opportunities_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `sales_tasks` ADD CONSTRAINT `sales_tasks_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `sales_tasks` ADD CONSTRAINT `sales_tasks_company_id_firm_id_fkey` FOREIGN KEY (`company_id`, `firm_id`) REFERENCES `companies` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `sales_tasks` ADD CONSTRAINT `sales_tasks_lead_id_firm_id_fkey` FOREIGN KEY (`lead_id`, `firm_id`) REFERENCES `leads` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `sales_tasks` ADD CONSTRAINT `sales_tasks_opportunity_id_firm_id_fkey` FOREIGN KEY (`opportunity_id`, `firm_id`) REFERENCES `opportunities` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `sales_tasks` ADD CONSTRAINT `sales_tasks_assigned_to_id_firm_id_fkey` FOREIGN KEY (`assigned_to_id`, `firm_id`) REFERENCES `users` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `sales_tasks` ADD CONSTRAINT `sales_tasks_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `sales_activities` ADD CONSTRAINT `sales_activities_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `sales_activities` ADD CONSTRAINT `sales_activities_company_id_firm_id_fkey` FOREIGN KEY (`company_id`, `firm_id`) REFERENCES `companies` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `sales_activities` ADD CONSTRAINT `sales_activities_lead_id_firm_id_fkey` FOREIGN KEY (`lead_id`, `firm_id`) REFERENCES `leads` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `sales_activities` ADD CONSTRAINT `sales_activities_opportunity_id_firm_id_fkey` FOREIGN KEY (`opportunity_id`, `firm_id`) REFERENCES `opportunities` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `sales_activities` ADD CONSTRAINT `sales_activities_task_id_firm_id_fkey` FOREIGN KEY (`task_id`, `firm_id`) REFERENCES `sales_tasks` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `sales_activities` ADD CONSTRAINT `sales_activities_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `sales_orders` ADD CONSTRAINT `sales_orders_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `sales_orders` ADD CONSTRAINT `sales_orders_company_id_firm_id_fkey` FOREIGN KEY (`company_id`, `firm_id`) REFERENCES `companies` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `sales_orders` ADD CONSTRAINT `sales_orders_source_quotation_id_firm_id_company_id_fkey` FOREIGN KEY (`source_quotation_id`, `firm_id`, `company_id`) REFERENCES `quotations` (`id`, `firm_id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `sales_orders` ADD CONSTRAINT `sales_orders_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `sales_order_lines` ADD CONSTRAINT `sales_order_lines_sales_order_id_firm_id_fkey` FOREIGN KEY (`sales_order_id`, `firm_id`) REFERENCES `sales_orders` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `fulfillments` ADD CONSTRAINT `fulfillments_sales_order_id_firm_id_fkey` FOREIGN KEY (`sales_order_id`, `firm_id`) REFERENCES `sales_orders` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `fulfillments` ADD CONSTRAINT `fulfillments_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `fulfillments` ADD CONSTRAINT `fulfillments_cancelled_by_id_fkey` FOREIGN KEY (`cancelled_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `fulfillment_lines` ADD CONSTRAINT `fulfillment_lines_fulfillment_id_firm_id_sales_order_id_fkey` FOREIGN KEY (`fulfillment_id`, `firm_id`, `sales_order_id`) REFERENCES `fulfillments` (`id`, `firm_id`, `sales_order_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `fulfillment_lines` ADD CONSTRAINT `fulfillment_lines_sales_order_line_id_firm_id_sales_order_i_fkey` FOREIGN KEY (`sales_order_line_id`, `firm_id`, `sales_order_id`) REFERENCES `sales_order_lines` (`id`, `firm_id`, `sales_order_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `sales_order_invoice_lines` ADD CONSTRAINT `sales_order_invoice_lines_sales_order_line_id_firm_id_sales_fkey` FOREIGN KEY (`sales_order_line_id`, `firm_id`, `sales_order_id`) REFERENCES `sales_order_lines` (`id`, `firm_id`, `sales_order_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `sales_order_invoice_lines` ADD CONSTRAINT `sales_order_invoice_lines_invoice_id_firm_id_sales_order_id_fkey` FOREIGN KEY (`invoice_id`, `firm_id`, `sales_order_id`) REFERENCES `invoices` (`id`, `firm_id`, `source_sales_order_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `sales_order_history` ADD CONSTRAINT `sales_order_history_sales_order_id_firm_id_fkey` FOREIGN KEY (`sales_order_id`, `firm_id`) REFERENCES `sales_orders` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `sales_order_history` ADD CONSTRAINT `sales_order_history_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `portal_identities` ADD CONSTRAINT `portal_identities_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `portal_identities` ADD CONSTRAINT `portal_identities_company_id_firm_id_fkey` FOREIGN KEY (`company_id`, `firm_id`) REFERENCES `companies` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `portal_identities` ADD CONSTRAINT `portal_identities_contact_id_company_id_fkey` FOREIGN KEY (`contact_id`, `company_id`) REFERENCES `company_contacts` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `portal_invitations` ADD CONSTRAINT `portal_invitations_identity_id_firm_id_company_id_fkey` FOREIGN KEY (`identity_id`, `firm_id`, `company_id`) REFERENCES `portal_identities` (`id`, `firm_id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `portal_invitations` ADD CONSTRAINT `portal_invitations_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `portal_sessions` ADD CONSTRAINT `portal_sessions_identity_id_firm_id_company_id_fkey` FOREIGN KEY (`identity_id`, `firm_id`, `company_id`) REFERENCES `portal_identities` (`id`, `firm_id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `portal_sessions` ADD CONSTRAINT `portal_sessions_invitation_id_firm_id_company_id_identity_i_fkey` FOREIGN KEY (`invitation_id`, `firm_id`, `company_id`, `identity_id`) REFERENCES `portal_invitations` (`id`, `firm_id`, `company_id`, `identity_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `portal_grants` ADD CONSTRAINT `portal_grants_identity_id_firm_id_company_id_fkey` FOREIGN KEY (`identity_id`, `firm_id`, `company_id`) REFERENCES `portal_identities` (`id`, `firm_id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `portal_grants` ADD CONSTRAINT `portal_grants_quotation_id_firm_id_company_id_fkey` FOREIGN KEY (`quotation_id`, `firm_id`, `company_id`) REFERENCES `quotations` (`id`, `firm_id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `portal_grants` ADD CONSTRAINT `portal_grants_invoice_id_firm_id_company_id_fkey` FOREIGN KEY (`invoice_id`, `firm_id`, `company_id`) REFERENCES `invoices` (`id`, `firm_id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `portal_grants` ADD CONSTRAINT `portal_grants_sales_order_id_firm_id_company_id_fkey` FOREIGN KEY (`sales_order_id`, `firm_id`, `company_id`) REFERENCES `sales_orders` (`id`, `firm_id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `portal_grants` ADD CONSTRAINT `portal_grants_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `document_acceptances` ADD CONSTRAINT `document_acceptances_quotation_id_firm_id_company_id_fkey` FOREIGN KEY (`quotation_id`, `firm_id`, `company_id`) REFERENCES `quotations` (`id`, `firm_id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `document_acceptances` ADD CONSTRAINT `document_acceptances_grant_id_firm_id_company_id_identity_i_fkey` FOREIGN KEY (`grant_id`, `firm_id`, `company_id`, `identity_id`) REFERENCES `portal_grants` (`id`, `firm_id`, `company_id`, `identity_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `document_acceptances` ADD CONSTRAINT `document_acceptances_identity_id_firm_id_company_id_fkey` FOREIGN KEY (`identity_id`, `firm_id`, `company_id`) REFERENCES `portal_identities` (`id`, `firm_id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `document_acceptances` ADD CONSTRAINT `document_acceptances_session_id_firm_id_company_id_identity_fkey` FOREIGN KEY (`session_id`, `firm_id`, `company_id`, `identity_id`) REFERENCES `portal_sessions` (`id`, `firm_id`, `company_id`, `identity_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_source_sales_order_id_firm_id_company_id_fkey` FOREIGN KEY (`source_sales_order_id`, `firm_id`, `company_id`) REFERENCES `sales_orders` (`id`, `firm_id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
