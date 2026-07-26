-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `password_hash` VARCHAR(191) NOT NULL,
    `role` ENUM('ADMIN') NOT NULL DEFAULT 'ADMIN',
    `status` ENUM('ACTIVE', 'INACTIVE', 'LOCKED') NOT NULL DEFAULT 'ACTIVE',
    `last_login_at` DATETIME(3) NULL,
    `password_changed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    UNIQUE INDEX `users_username_key`(`username`),
    INDEX `users_status_idx`(`status`),
    INDEX `users_deleted_at_idx`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_sessions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `refresh_token_hash` VARCHAR(191) NOT NULL,
    `ip_address` VARCHAR(45) NULL,
    `user_agent` TEXT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `auth_sessions_refresh_token_hash_idx`(`refresh_token_hash`),
    INDEX `auth_sessions_user_id_idx`(`user_id`),
    INDEX `auth_sessions_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `business_profiles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `legal_name` VARCHAR(191) NOT NULL,
    `display_name` VARCHAR(191) NOT NULL,
    `gstin` VARCHAR(20) NULL,
    `pan` VARCHAR(20) NULL,
    `cin` VARCHAR(30) NULL,
    `address_line_1` VARCHAR(191) NOT NULL,
    `address_line_2` VARCHAR(191) NULL,
    `city` VARCHAR(191) NOT NULL,
    `state` VARCHAR(191) NOT NULL,
    `postal_code` VARCHAR(20) NOT NULL,
    `country` VARCHAR(191) NOT NULL DEFAULT 'India',
    `primary_phone` VARCHAR(30) NULL,
    `secondary_phone` VARCHAR(30) NULL,
    `primary_email` VARCHAR(191) NULL,
    `secondary_email` VARCHAR(191) NULL,
    `website` VARCHAR(191) NULL,
    `logo_path` VARCHAR(191) NULL,
    `signature_path` VARCHAR(191) NULL,
    `stamp_path` VARCHAR(191) NULL,
    `primary_colour` VARCHAR(20) NOT NULL DEFAULT '#168A56',
    `secondary_colour` VARCHAR(20) NOT NULL DEFAULT '#082B67',
    `default_currency` VARCHAR(3) NOT NULL DEFAULT 'INR',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bank_details` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `business_profile_id` INTEGER NOT NULL,
    `bank_name` VARCHAR(191) NOT NULL,
    `account_name` VARCHAR(191) NOT NULL,
    `account_number` VARCHAR(50) NOT NULL,
    `account_type` VARCHAR(50) NULL,
    `ifsc_code` VARCHAR(20) NULL,
    `branch_name` VARCHAR(191) NULL,
    `swift_code` VARCHAR(20) NULL,
    `upi_id` VARCHAR(191) NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `bank_details_business_profile_id_idx`(`business_profile_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quotation_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `business_profile_id` INTEGER NOT NULL,
    `quotation_prefix` VARCHAR(50) NOT NULL DEFAULT 'BUMINEX',
    `financial_year_format` VARCHAR(20) NOT NULL DEFAULT 'YYYY-YY',
    `next_sequence_number` INTEGER NOT NULL DEFAULT 1,
    `sequence_reset_rule` ENUM('FINANCIAL_YEAR', 'CALENDAR_YEAR', 'NEVER') NOT NULL DEFAULT 'FINANCIAL_YEAR',
    `default_validity_days` INTEGER NOT NULL DEFAULT 30,
    `default_tax_mode` ENUM('CGST_SGST', 'IGST', 'NONE') NOT NULL DEFAULT 'CGST_SGST',
    `default_gst_rate` DECIMAL(5, 2) NOT NULL DEFAULT 18.00,
    `default_delivery_terms` TEXT NULL,
    `default_dispatch_terms` TEXT NULL,
    `default_payment_terms` TEXT NULL,
    `default_freight_terms` TEXT NULL,
    `default_warranty_terms` TEXT NULL,
    `default_remarks` TEXT NULL,
    `default_terms_and_conditions` LONGTEXT NULL,
    `show_bank_details` BOOLEAN NOT NULL DEFAULT true,
    `show_amount_in_words` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `quotation_settings_business_profile_id_key`(`business_profile_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `companies` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `company_code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `legal_name` VARCHAR(191) NULL,
    `gstin` VARCHAR(20) NULL,
    `pan` VARCHAR(20) NULL,
    `website` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by_id` INTEGER NULL,
    `updated_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `companies_company_code_key`(`company_code`),
    INDEX `companies_name_idx`(`name`),
    INDEX `companies_gstin_idx`(`gstin`),
    INDEX `companies_is_active_idx`(`is_active`),
    INDEX `companies_deleted_at_idx`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `company_contacts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `designation` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(30) NULL,
    `alternate_phone` VARCHAR(30) NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `company_contacts_company_id_idx`(`company_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `company_addresses` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER NOT NULL,
    `address_type` ENUM('BILLING', 'SHIPPING', 'OTHER') NOT NULL,
    `address_line_1` VARCHAR(191) NOT NULL,
    `address_line_2` VARCHAR(191) NULL,
    `city` VARCHAR(191) NOT NULL,
    `state` VARCHAR(191) NOT NULL,
    `postal_code` VARCHAR(20) NOT NULL,
    `country` VARCHAR(191) NOT NULL DEFAULT 'India',
    `is_primary` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `company_addresses_company_id_idx`(`company_id`),
    INDEX `company_addresses_address_type_idx`(`address_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `item_categories` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `item_categories_name_key`(`name`),
    UNIQUE INDEX `item_categories_slug_key`(`slug`),
    INDEX `item_categories_deleted_at_idx`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `measurement_units` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(50) NOT NULL,
    `allow_decimal` BOOLEAN NOT NULL DEFAULT true,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `measurement_units_name_key`(`name`),
    UNIQUE INDEX `measurement_units_symbol_key`(`symbol`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `item_code` VARCHAR(50) NOT NULL,
    `category_id` INTEGER NULL,
    `name` VARCHAR(191) NOT NULL,
    `short_description` TEXT NULL,
    `detailed_description` LONGTEXT NULL,
    `specifications` JSON NULL,
    `measurement_unit_id` INTEGER NOT NULL,
    `default_rate` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `hsn_code` VARCHAR(20) NULL,
    `gst_rate` DECIMAL(5, 2) NOT NULL DEFAULT 18.00,
    `image_path` VARCHAR(191) NULL,
    `source_type` ENUM('MANUAL', 'WEBSITE_IMPORT', 'CSV_IMPORT') NOT NULL DEFAULT 'MANUAL',
    `source_url` VARCHAR(500) NULL,
    `source_external_id` VARCHAR(191) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by_id` INTEGER NULL,
    `updated_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `items_item_code_key`(`item_code`),
    INDEX `items_name_idx`(`name`),
    INDEX `items_category_id_idx`(`category_id`),
    INDEX `items_measurement_unit_id_idx`(`measurement_unit_id`),
    INDEX `items_source_type_idx`(`source_type`),
    INDEX `items_is_active_idx`(`is_active`),
    INDEX `items_deleted_at_idx`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quotations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `quotation_number` VARCHAR(50) NOT NULL,
    `revision_number` INTEGER NOT NULL DEFAULT 0,
    `company_id` INTEGER NOT NULL,
    `company_contact_id` INTEGER NULL,
    `billing_address_id` INTEGER NULL,
    `shipping_address_id` INTEGER NULL,
    `company_name_snapshot` VARCHAR(191) NOT NULL,
    `company_gstin_snapshot` VARCHAR(20) NULL,
    `company_pan_snapshot` VARCHAR(20) NULL,
    `contact_name_snapshot` VARCHAR(191) NULL,
    `contact_email_snapshot` VARCHAR(191) NULL,
    `contact_phone_snapshot` VARCHAR(30) NULL,
    `billing_address_snapshot` JSON NULL,
    `shipping_address_snapshot` JSON NULL,
    `quotation_date` DATETIME(3) NOT NULL,
    `valid_until` DATETIME(3) NULL,
    `customer_reference` VARCHAR(191) NULL,
    `internal_reference` VARCHAR(191) NULL,
    `status` ENUM('DRAFT', 'PENDING', 'SENT', 'ACCEPTED', 'REJECTED', 'COMPLETED', 'EXPIRED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `currency` VARCHAR(3) NOT NULL DEFAULT 'INR',
    `tax_mode` ENUM('CGST_SGST', 'IGST', 'NONE') NOT NULL DEFAULT 'CGST_SGST',
    `subtotal` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `item_discount_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `quotation_discount_type` ENUM('NONE', 'PERCENTAGE', 'FIXED') NOT NULL DEFAULT 'NONE',
    `quotation_discount_value` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `quotation_discount_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `taxable_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `cgst_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `sgst_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `igst_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `freight_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `freight_included` BOOLEAN NOT NULL DEFAULT false,
    `freight_is_taxable` BOOLEAN NOT NULL DEFAULT false,
    `other_charges` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `round_off_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `grand_total` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `amount_in_words` TEXT NULL,
    `delivery_terms` TEXT NULL,
    `dispatch_terms` TEXT NULL,
    `payment_terms` TEXT NULL,
    `tax_terms` TEXT NULL,
    `freight_terms` TEXT NULL,
    `warranty_terms` TEXT NULL,
    `remarks` TEXT NULL,
    `terms_and_conditions` LONGTEXT NULL,
    `internal_notes` LONGTEXT NULL,
    `created_by_id` INTEGER NOT NULL,
    `updated_by_id` INTEGER NULL,
    `sent_at` DATETIME(3) NULL,
    `accepted_at` DATETIME(3) NULL,
    `rejected_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `quotations_quotation_number_key`(`quotation_number`),
    INDEX `quotations_quotation_date_idx`(`quotation_date`),
    INDEX `quotations_status_idx`(`status`),
    INDEX `quotations_company_id_idx`(`company_id`),
    INDEX `quotations_created_by_id_idx`(`created_by_id`),
    INDEX `quotations_deleted_at_idx`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quotation_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `quotation_id` INTEGER NOT NULL,
    `item_id` INTEGER NULL,
    `line_number` INTEGER NOT NULL,
    `item_code_snapshot` VARCHAR(50) NULL,
    `item_name_snapshot` VARCHAR(191) NOT NULL,
    `description_snapshot` LONGTEXT NULL,
    `specifications_snapshot` JSON NULL,
    `measurement_unit_snapshot` VARCHAR(50) NOT NULL,
    `quantity` DECIMAL(15, 3) NOT NULL DEFAULT 1.000,
    `unit_rate` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `discount_type` ENUM('NONE', 'PERCENTAGE', 'FIXED') NOT NULL DEFAULT 'NONE',
    `discount_value` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `discount_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `gst_rate` DECIMAL(5, 2) NOT NULL DEFAULT 18.00,
    `base_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `taxable_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `tax_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `line_total` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `quotation_items_quotation_id_sort_order_idx`(`quotation_id`, `sort_order`),
    UNIQUE INDEX `quotation_items_quotation_id_line_number_key`(`quotation_id`, `line_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quotation_status_history` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `quotation_id` INTEGER NOT NULL,
    `from_status` ENUM('DRAFT', 'PENDING', 'SENT', 'ACCEPTED', 'REJECTED', 'COMPLETED', 'EXPIRED', 'CANCELLED') NULL,
    `to_status` ENUM('DRAFT', 'PENDING', 'SENT', 'ACCEPTED', 'REJECTED', 'COMPLETED', 'EXPIRED', 'CANCELLED') NOT NULL,
    `comment` TEXT NULL,
    `changed_by_id` INTEGER NOT NULL,
    `changed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `quotation_status_history_quotation_id_idx`(`quotation_id`),
    INDEX `quotation_status_history_changed_by_id_idx`(`changed_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quotation_versions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `quotation_id` INTEGER NOT NULL,
    `version_number` INTEGER NOT NULL,
    `snapshot` JSON NOT NULL,
    `created_by_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `quotation_versions_quotation_id_version_number_key`(`quotation_id`, `version_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quotation_attachments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `quotation_id` INTEGER NOT NULL,
    `original_filename` VARCHAR(191) NOT NULL,
    `stored_filename` VARCHAR(191) NOT NULL,
    `file_path` VARCHAR(500) NOT NULL,
    `mime_type` VARCHAR(100) NOT NULL,
    `file_size` BIGINT NOT NULL,
    `uploaded_by_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `quotation_attachments_quotation_id_idx`(`quotation_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `generated_documents` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `quotation_id` INTEGER NOT NULL,
    `version_number` INTEGER NOT NULL,
    `document_type` ENUM('QUOTATION_PDF') NOT NULL DEFAULT 'QUOTATION_PDF',
    `file_path` VARCHAR(500) NOT NULL,
    `file_hash` VARCHAR(191) NULL,
    `generated_by_id` INTEGER NOT NULL,
    `generated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `generated_documents_quotation_id_idx`(`quotation_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `terms_templates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `term_type` ENUM('DELIVERY', 'DISPATCH', 'PAYMENT', 'TAX', 'FREIGHT', 'WARRANTY', 'REMARKS', 'GENERAL') NOT NULL,
    `content` LONGTEXT NOT NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `terms_templates_term_type_idx`(`term_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `import_batches` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `source_type` ENUM('MANUAL', 'WEBSITE_IMPORT', 'CSV_IMPORT') NOT NULL,
    `source_url` VARCHAR(500) NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `total_records` INTEGER NOT NULL DEFAULT 0,
    `successful_records` INTEGER NOT NULL DEFAULT 0,
    `failed_records` INTEGER NOT NULL DEFAULT 0,
    `started_by_id` INTEGER NOT NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,
    `error_summary` TEXT NULL,

    INDEX `import_batches_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `import_rows` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `import_batch_id` INTEGER NOT NULL,
    `source_identifier` VARCHAR(191) NULL,
    `raw_data` JSON NOT NULL,
    `processed_data` JSON NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'IMPORTED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `error_message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `import_rows_import_batch_id_idx`(`import_batch_id`),
    INDEX `import_rows_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NULL,
    `entity_type` VARCHAR(100) NOT NULL,
    `entity_id` VARCHAR(191) NOT NULL,
    `action` ENUM('CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'LOGIN', 'LOGOUT', 'PASSWORD_CHANGE', 'STATUS_CHANGE', 'GENERATE_PDF', 'IMPORT') NOT NULL,
    `old_values` JSON NULL,
    `new_values` JSON NULL,
    `ip_address` VARCHAR(45) NULL,
    `user_agent` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_entity_type_entity_id_idx`(`entity_type`, `entity_id`),
    INDEX `audit_logs_user_id_idx`(`user_id`),
    INDEX `audit_logs_action_idx`(`action`),
    INDEX `audit_logs_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_details` ADD CONSTRAINT `bank_details_business_profile_id_fkey` FOREIGN KEY (`business_profile_id`) REFERENCES `business_profiles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotation_settings` ADD CONSTRAINT `quotation_settings_business_profile_id_fkey` FOREIGN KEY (`business_profile_id`) REFERENCES `business_profiles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `companies` ADD CONSTRAINT `companies_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `companies` ADD CONSTRAINT `companies_updated_by_id_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_contacts` ADD CONSTRAINT `company_contacts_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_addresses` ADD CONSTRAINT `company_addresses_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `items` ADD CONSTRAINT `items_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `item_categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `items` ADD CONSTRAINT `items_measurement_unit_id_fkey` FOREIGN KEY (`measurement_unit_id`) REFERENCES `measurement_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `items` ADD CONSTRAINT `items_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `items` ADD CONSTRAINT `items_updated_by_id_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotations` ADD CONSTRAINT `quotations_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotations` ADD CONSTRAINT `quotations_company_contact_id_fkey` FOREIGN KEY (`company_contact_id`) REFERENCES `company_contacts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotations` ADD CONSTRAINT `quotations_billing_address_id_fkey` FOREIGN KEY (`billing_address_id`) REFERENCES `company_addresses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotations` ADD CONSTRAINT `quotations_shipping_address_id_fkey` FOREIGN KEY (`shipping_address_id`) REFERENCES `company_addresses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotations` ADD CONSTRAINT `quotations_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotations` ADD CONSTRAINT `quotations_updated_by_id_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotation_items` ADD CONSTRAINT `quotation_items_quotation_id_fkey` FOREIGN KEY (`quotation_id`) REFERENCES `quotations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotation_items` ADD CONSTRAINT `quotation_items_item_id_fkey` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotation_status_history` ADD CONSTRAINT `quotation_status_history_quotation_id_fkey` FOREIGN KEY (`quotation_id`) REFERENCES `quotations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotation_status_history` ADD CONSTRAINT `quotation_status_history_changed_by_id_fkey` FOREIGN KEY (`changed_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotation_versions` ADD CONSTRAINT `quotation_versions_quotation_id_fkey` FOREIGN KEY (`quotation_id`) REFERENCES `quotations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotation_versions` ADD CONSTRAINT `quotation_versions_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotation_attachments` ADD CONSTRAINT `quotation_attachments_quotation_id_fkey` FOREIGN KEY (`quotation_id`) REFERENCES `quotations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotation_attachments` ADD CONSTRAINT `quotation_attachments_uploaded_by_id_fkey` FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `generated_documents` ADD CONSTRAINT `generated_documents_quotation_id_fkey` FOREIGN KEY (`quotation_id`) REFERENCES `quotations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `generated_documents` ADD CONSTRAINT `generated_documents_generated_by_id_fkey` FOREIGN KEY (`generated_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_batches` ADD CONSTRAINT `import_batches_started_by_id_fkey` FOREIGN KEY (`started_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_rows` ADD CONSTRAINT `import_rows_import_batch_id_fkey` FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
