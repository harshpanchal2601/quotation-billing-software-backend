-- Additive Wave 04 billing storage. No historical quotation or financial rows are rewritten.
CREATE UNIQUE INDEX `companies_id_firm_id_key` ON `companies` (`id`, `firm_id`);
CREATE UNIQUE INDEX `items_id_firm_id_key` ON `items` (`id`, `firm_id`);
CREATE UNIQUE INDEX `quotations_id_firm_id_key` ON `quotations` (`id`, `firm_id`);

CREATE TABLE `invoice_settings` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `firm_id` INTEGER NOT NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `config` JSON NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `invoice_settings_firm_id_key` (`firm_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `invoices` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `firm_id` INTEGER NOT NULL,
  `company_id` INTEGER NOT NULL,
  `status` ENUM('DRAFT', 'ISSUED', 'VOID') NOT NULL DEFAULT 'DRAFT',
  `kind` ENUM('INVOICE', 'PROFORMA', 'CREDIT_NOTE', 'DEBIT_NOTE') NOT NULL DEFAULT 'INVOICE',
  `document_number` VARCHAR(16) NULL,
  `period` VARCHAR(32) NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `invoice_date` DATE NOT NULL,
  `due_date` DATE NULL,
  `customer_reference` VARCHAR(191) NULL,
  `payment_terms` TEXT NULL,
  `notes` TEXT NULL,
  `currency` VARCHAR(3) NOT NULL,
  `buyer_snapshot` JSON NOT NULL,
  `financial_policy_snapshot` JSON NOT NULL,
  `seller_snapshot` JSON NULL,
  `bank_snapshot` JSON NULL,
  `custom_field_schema` JSON NOT NULL,
  `custom_field_values` JSON NOT NULL,
  `presentation_snapshot` JSON NOT NULL,
  `issue_snapshot` JSON NULL,
  `supply_snapshot` JSON NOT NULL,
  `source_snapshot` JSON NULL,
  `source_quotation_id` INTEGER NULL,
  `source_proforma_id` INTEGER NULL,
  `source_invoice_id` INTEGER NULL,
  `adjustment_reason` TEXT NULL,
  `issued_at` DATETIME(3) NULL,
  `voided_at` DATETIME(3) NULL,
  `void_reason` TEXT NULL,
  `subtotal` DECIMAL(24,3) NOT NULL,
  `discount_amount` DECIMAL(24,3) NOT NULL,
  `taxable_amount` DECIMAL(24,3) NOT NULL,
  `tax_amount` DECIMAL(24,3) NOT NULL,
  `round_off_amount` DECIMAL(24,3) NOT NULL,
  `grand_total` DECIMAL(24,3) NOT NULL,
  `idempotency_key` VARCHAR(100) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `created_by_id` INTEGER NOT NULL,
  `updated_by_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `invoices_id_firm_id_key` (`id`, `firm_id`),
  UNIQUE INDEX `invoices_firm_id_idempotency_key_key` (`firm_id`, `idempotency_key`),
  UNIQUE INDEX `invoices_firm_id_document_number_key` (`firm_id`, `document_number`),
  UNIQUE INDEX `invoices_firm_id_source_quotation_id_key` (`firm_id`, `source_quotation_id`),
  UNIQUE INDEX `invoices_firm_id_source_proforma_id_key` (`firm_id`, `source_proforma_id`),
  INDEX `invoices_source_invoice_id_firm_id_idx` (`source_invoice_id`, `firm_id`),
  INDEX `invoices_firm_id_invoice_date_id_idx` (`firm_id`, `invoice_date`, `id`),
  INDEX `invoices_firm_id_status_created_at_id_idx` (`firm_id`, `status`, `created_at`, `id`),
  INDEX `invoices_company_id_firm_id_idx` (`company_id`, `firm_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `invoice_lines` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `firm_id` INTEGER NOT NULL,
  `invoice_id` INTEGER NOT NULL,
  `item_id` INTEGER NULL,
  `line_number` INTEGER NOT NULL,
  `snapshot` JSON NOT NULL,
  UNIQUE INDEX `invoice_lines_invoice_id_line_number_key` (`invoice_id`, `line_number`),
  INDEX `invoice_lines_item_id_firm_id_idx` (`item_id`, `firm_id`),
  INDEX `invoice_lines_invoice_id_firm_id_fkey` (`invoice_id`, `firm_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `invoice_status_history` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `firm_id` INTEGER NOT NULL,
  `invoice_id` INTEGER NOT NULL,
  `version` INTEGER NOT NULL,
  `from_status` ENUM('DRAFT', 'ISSUED', 'VOID') NULL,
  `to_status` ENUM('DRAFT', 'ISSUED', 'VOID') NOT NULL,
  `changed_by_id` INTEGER NOT NULL,
  `changed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `invoice_status_history_invoice_id_version_key` (`invoice_id`, `version`),
  INDEX `invoice_status_history_firm_id_changed_at_idx` (`firm_id`, `changed_at`),
  INDEX `invoice_status_history_invoice_id_firm_id_fkey` (`invoice_id`, `firm_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `invoice_documents` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `firm_id` INTEGER NOT NULL,
  `invoice_id` INTEGER NOT NULL,
  `version_number` INTEGER NOT NULL,
  `file_path` VARCHAR(191) NOT NULL,
  `file_hash` CHAR(64) NOT NULL,
  `file_size` INTEGER NOT NULL,
  `generated_by_id` INTEGER NOT NULL,
  `generated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `invoice_documents_invoice_id_version_number_key` (`invoice_id`, `version_number`),
  INDEX `invoice_documents_firm_id_generated_at_idx` (`firm_id`, `generated_at`),
  INDEX `invoice_documents_invoice_id_firm_id_fkey` (`invoice_id`, `firm_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `invoice_settings` ADD CONSTRAINT `invoice_settings_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_company_id_firm_id_fkey` FOREIGN KEY (`company_id`, `firm_id`) REFERENCES `companies` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_source_quotation_id_firm_id_fkey` FOREIGN KEY (`source_quotation_id`, `firm_id`) REFERENCES `quotations` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_source_proforma_id_firm_id_fkey` FOREIGN KEY (`source_proforma_id`, `firm_id`) REFERENCES `invoices` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_source_invoice_id_firm_id_fkey` FOREIGN KEY (`source_invoice_id`, `firm_id`) REFERENCES `invoices` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_updated_by_id_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `invoice_lines` ADD CONSTRAINT `invoice_lines_invoice_id_firm_id_fkey` FOREIGN KEY (`invoice_id`, `firm_id`) REFERENCES `invoices` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `invoice_lines` ADD CONSTRAINT `invoice_lines_item_id_firm_id_fkey` FOREIGN KEY (`item_id`, `firm_id`) REFERENCES `items` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `invoice_status_history` ADD CONSTRAINT `invoice_status_history_invoice_id_firm_id_fkey` FOREIGN KEY (`invoice_id`, `firm_id`) REFERENCES `invoices` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `invoice_status_history` ADD CONSTRAINT `invoice_status_history_changed_by_id_fkey` FOREIGN KEY (`changed_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `invoice_documents` ADD CONSTRAINT `invoice_documents_invoice_id_firm_id_fkey` FOREIGN KEY (`invoice_id`, `firm_id`) REFERENCES `invoices` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `invoice_documents` ADD CONSTRAINT `invoice_documents_generated_by_id_fkey` FOREIGN KEY (`generated_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
