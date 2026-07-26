-- Durable, revision-aware quotation communication attempts.
CREATE TABLE `quotation_communications` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `quotation_id` INTEGER NOT NULL,
  `generated_document_id` INTEGER NULL,
  `sender_user_id` INTEGER NULL,
  `communication_type` ENUM('QUOTATION_EMAIL') NOT NULL DEFAULT 'QUOTATION_EMAIL',
  `status` ENUM('PENDING', 'ACCEPTED', 'FAILED') NOT NULL DEFAULT 'PENDING',
  `attempt_number` INTEGER NOT NULL DEFAULT 1,
  `previous_attempt_id` INTEGER NULL,
  `to_recipients` JSON NOT NULL,
  `cc_recipients` JSON NOT NULL,
  `bcc_recipients` JSON NOT NULL,
  `subject_snapshot` VARCHAR(200) NOT NULL,
  `message_snapshot` LONGTEXT NOT NULL,
  `document_snapshot` JSON NULL,
  `attachment_snapshots` JSON NULL,
  `provider_message_id` VARCHAR(191) NULL,
  `failure_category` VARCHAR(100) NULL,
  `failure_summary` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `accepted_at` DATETIME(3) NULL,
  `failed_at` DATETIME(3) NULL,

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `quotation_communications_previous_attempt_id_key`
  ON `quotation_communications`(`previous_attempt_id`);

CREATE INDEX `quotation_communications_quotation_id_idx`
  ON `quotation_communications`(`quotation_id`);

CREATE INDEX `quotation_communications_generated_document_id_idx`
  ON `quotation_communications`(`generated_document_id`);

CREATE INDEX `quotation_communications_sender_user_id_idx`
  ON `quotation_communications`(`sender_user_id`);

CREATE INDEX `quotation_communications_status_idx`
  ON `quotation_communications`(`status`);

CREATE INDEX `quotation_communications_created_at_idx`
  ON `quotation_communications`(`created_at`);

ALTER TABLE `quotation_communications`
  ADD CONSTRAINT `quotation_communications_quotation_id_fkey`
    FOREIGN KEY (`quotation_id`) REFERENCES `quotations`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `quotation_communications_generated_document_id_fkey`
    FOREIGN KEY (`generated_document_id`) REFERENCES `generated_documents`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `quotation_communications_sender_user_id_fkey`
    FOREIGN KEY (`sender_user_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `quotation_communications_previous_attempt_id_fkey`
    FOREIGN KEY (`previous_attempt_id`) REFERENCES `quotation_communications`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
