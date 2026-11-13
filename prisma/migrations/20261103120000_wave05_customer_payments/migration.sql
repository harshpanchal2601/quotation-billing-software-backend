-- Additive Wave 05 storage. No existing invoice, quotation, subscription or
-- financial snapshot is rewritten. Apply only after the Wave 04 migration.
CREATE UNIQUE INDEX `invoices_id_firm_company_currency_key` ON `invoices` (`id`, `firm_id`, `company_id`, `currency`);

CREATE TABLE `customer_payments` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `firm_id` INTEGER NOT NULL,
  `company_id` INTEGER NOT NULL,
  `currency` VARCHAR(3) NOT NULL,
  `amount` DECIMAL(24,3) NOT NULL,
  `method` ENUM('CASH', 'BANK_TRANSFER', 'CHEQUE', 'EXTERNAL_CONFIRMED') NOT NULL,
  `reference` VARCHAR(191) NULL,
  `received_date` DATE NOT NULL,
  `idempotency_key` VARCHAR(100) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `created_by_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `customer_payments_id_firm_id_key` (`id`, `firm_id`),
  UNIQUE INDEX `customer_payments_id_firm_company_currency_key` (`id`, `firm_id`, `company_id`, `currency`),
  UNIQUE INDEX `customer_payments_firm_id_idempotency_key_key` (`firm_id`, `idempotency_key`),
  INDEX `customer_payments_firm_id_company_id_currency_id_idx` (`firm_id`, `company_id`, `currency`, `id`),
  INDEX `customer_payments_firm_id_received_date_id_idx` (`firm_id`, `received_date`, `id`),
  CONSTRAINT `customer_payments_amount_check` CHECK (`amount` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `payment_allocations` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `firm_id` INTEGER NOT NULL,
  `company_id` INTEGER NOT NULL,
  `currency` VARCHAR(3) NOT NULL,
  `payment_id` INTEGER NOT NULL,
  `invoice_id` INTEGER NOT NULL,
  `amount` DECIMAL(24,3) NOT NULL,
  `request_key` VARCHAR(100) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `created_by_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `payment_allocations_payment_id_request_key_invoice_id_key` (`payment_id`, `request_key`, `invoice_id`),
  INDEX `payment_allocations_firm_id_invoice_id_idx` (`firm_id`, `invoice_id`),
  INDEX `payment_allocations_firm_id_payment_id_idx` (`firm_id`, `payment_id`),
  INDEX `payment_allocations_invoice_owner_idx` (`invoice_id`, `firm_id`, `company_id`, `currency`),
  INDEX `payment_allocations_payment_owner_idx` (`payment_id`, `firm_id`, `company_id`, `currency`),
  CONSTRAINT `payment_allocations_amount_check` CHECK (`amount` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `payment_reversals` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `firm_id` INTEGER NOT NULL,
  `payment_id` INTEGER NOT NULL,
  `amount` DECIMAL(24,3) NOT NULL,
  `reason` TEXT NOT NULL,
  `idempotency_key` VARCHAR(100) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `created_by_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `payment_reversals_payment_id_key` (`payment_id`),
  UNIQUE INDEX `payment_reversals_payment_id_firm_id_key` (`payment_id`, `firm_id`),
  UNIQUE INDEX `payment_reversals_firm_id_idempotency_key_key` (`firm_id`, `idempotency_key`),
  CONSTRAINT `payment_reversals_amount_check` CHECK (`amount` >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `customer_refunds` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `firm_id` INTEGER NOT NULL,
  `payment_id` INTEGER NOT NULL,
  `amount` DECIMAL(24,3) NOT NULL,
  `paid_date` DATE NOT NULL,
  `reference` VARCHAR(191) NOT NULL,
  `reason` TEXT NOT NULL,
  `idempotency_key` VARCHAR(100) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `created_by_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `customer_refunds_firm_id_idempotency_key_key` (`firm_id`, `idempotency_key`),
  INDEX `customer_refunds_payment_id_firm_id_idx` (`payment_id`, `firm_id`),
  INDEX `customer_refunds_firm_id_payment_id_idx` (`firm_id`, `payment_id`),
  CONSTRAINT `customer_refunds_amount_check` CHECK (`amount` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `billing_schedules` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `firm_id` INTEGER NOT NULL,
  `company_id` INTEGER NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `status` ENUM('PAUSED', 'ACTIVE', 'CANCELLED', 'COMPLETED') NOT NULL DEFAULT 'PAUSED',
  `version` INTEGER NOT NULL DEFAULT 1,
  `next_period` DATE NOT NULL,
  `idempotency_key` VARCHAR(100) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `created_by_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `billing_schedules_id_firm_id_key` (`id`, `firm_id`),
  UNIQUE INDEX `billing_schedules_firm_id_idempotency_key_key` (`firm_id`, `idempotency_key`),
  INDEX `billing_schedules_firm_id_company_id_idx` (`firm_id`, `company_id`),
  INDEX `billing_schedules_status_next_period_id_idx` (`status`, `next_period`, `id`),
  CONSTRAINT `billing_schedules_version_check` CHECK (`version` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `billing_schedule_versions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `firm_id` INTEGER NOT NULL,
  `schedule_id` INTEGER NOT NULL,
  `version` INTEGER NOT NULL,
  `config` JSON NOT NULL,
  `preview` JSON NOT NULL,
  `approved_at` DATETIME(3) NULL,
  `approved_by_id` INTEGER NULL,
  `created_by_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `billing_schedule_versions_schedule_id_firm_id_version_key` (`schedule_id`, `firm_id`, `version`),
  CONSTRAINT `billing_schedule_versions_version_check` CHECK (`version` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `billing_schedule_runs` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `firm_id` INTEGER NOT NULL,
  `schedule_id` INTEGER NOT NULL,
  `version` INTEGER NOT NULL,
  `period` DATE NOT NULL,
  `status` ENUM('QUEUED', 'DRAFT_CREATED', 'CANCELLED') NOT NULL DEFAULT 'QUEUED',
  `retry_count` INTEGER NOT NULL DEFAULT 0,
  `invoice_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completed_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `billing_schedule_runs_schedule_id_period_key` (`schedule_id`, `period`),
  UNIQUE INDEX `billing_schedule_runs_invoice_id_key` (`invoice_id`),
  UNIQUE INDEX `billing_schedule_runs_invoice_id_firm_id_key` (`invoice_id`, `firm_id`),
  INDEX `billing_schedule_runs_firm_id_created_at_id_idx` (`firm_id`, `created_at`, `id`),
  INDEX `billing_schedule_runs_schedule_id_firm_id_version_idx` (`schedule_id`, `firm_id`, `version`),
  CONSTRAINT `billing_schedule_runs_retry_check` CHECK (`retry_count` >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `customer_payments` ADD CONSTRAINT `customer_payments_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `customer_payments` ADD CONSTRAINT `customer_payments_company_id_firm_id_fkey` FOREIGN KEY (`company_id`, `firm_id`) REFERENCES `companies` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `customer_payments` ADD CONSTRAINT `customer_payments_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `payment_allocations` ADD CONSTRAINT `payment_allocations_payment_id_firm_id_company_id_currency_fkey` FOREIGN KEY (`payment_id`, `firm_id`, `company_id`, `currency`) REFERENCES `customer_payments` (`id`, `firm_id`, `company_id`, `currency`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `payment_allocations` ADD CONSTRAINT `payment_allocations_invoice_id_firm_id_company_id_currency_fkey` FOREIGN KEY (`invoice_id`, `firm_id`, `company_id`, `currency`) REFERENCES `invoices` (`id`, `firm_id`, `company_id`, `currency`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `payment_allocations` ADD CONSTRAINT `payment_allocations_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `payment_reversals` ADD CONSTRAINT `payment_reversals_payment_id_firm_id_fkey` FOREIGN KEY (`payment_id`, `firm_id`) REFERENCES `customer_payments` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `payment_reversals` ADD CONSTRAINT `payment_reversals_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `customer_refunds` ADD CONSTRAINT `customer_refunds_payment_id_firm_id_fkey` FOREIGN KEY (`payment_id`, `firm_id`) REFERENCES `customer_payments` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `customer_refunds` ADD CONSTRAINT `customer_refunds_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `billing_schedules` ADD CONSTRAINT `billing_schedules_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `billing_schedules` ADD CONSTRAINT `billing_schedules_company_id_firm_id_fkey` FOREIGN KEY (`company_id`, `firm_id`) REFERENCES `companies` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `billing_schedules` ADD CONSTRAINT `billing_schedules_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `billing_schedule_versions` ADD CONSTRAINT `billing_schedule_versions_schedule_id_firm_id_fkey` FOREIGN KEY (`schedule_id`, `firm_id`) REFERENCES `billing_schedules` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `billing_schedule_versions` ADD CONSTRAINT `billing_schedule_versions_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `billing_schedule_versions` ADD CONSTRAINT `billing_schedule_versions_approved_by_id_fkey` FOREIGN KEY (`approved_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `billing_schedule_runs` ADD CONSTRAINT `billing_schedule_runs_schedule_id_firm_id_fkey` FOREIGN KEY (`schedule_id`, `firm_id`) REFERENCES `billing_schedules` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `billing_schedule_runs` ADD CONSTRAINT `billing_schedule_runs_schedule_id_firm_id_version_fkey` FOREIGN KEY (`schedule_id`, `firm_id`, `version`) REFERENCES `billing_schedule_versions` (`schedule_id`, `firm_id`, `version`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `billing_schedule_runs` ADD CONSTRAINT `billing_schedule_runs_invoice_id_firm_id_fkey` FOREIGN KEY (`invoice_id`, `firm_id`) REFERENCES `invoices` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
