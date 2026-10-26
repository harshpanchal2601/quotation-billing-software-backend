-- Additive Wave 02 migration. Review/apply only in an authorized environment.
-- No quotation, invoice, financial history or customer record is rewritten.
CREATE TABLE `platform_feature_switches` (
  `key` VARCHAR(100) NOT NULL, `hard_disabled` BOOLEAN NOT NULL,
  `reason` VARCHAR(500) NOT NULL, `author_id` INTEGER NOT NULL, `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `platform_plans` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `slug` VARCHAR(100) NOT NULL, `name` VARCHAR(191) NOT NULL,
  `is_legacy` BOOLEAN NOT NULL DEFAULT false, `archived_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `platform_plans_slug_key` (`slug`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `platform_plan_versions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `plan_id` INTEGER NOT NULL, `revision` INTEGER NOT NULL,
  `policy` JSON NULL, `price` DECIMAL(18,2) NULL, `currency` CHAR(3) NULL,
  `published_at` DATETIME(3) NULL, `created_by_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `platform_plan_versions_plan_id_revision_key` (`plan_id`, `revision`),
  INDEX `platform_plan_versions_plan_id_published_at_idx` (`plan_id`, `published_at`),
  PRIMARY KEY (`id`), CONSTRAINT `platform_plan_versions_plan_id_fkey` FOREIGN KEY (`plan_id`)
    REFERENCES `platform_plans` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `platform_plan_features` (
  `plan_version_id` INTEGER NOT NULL, `feature_key` VARCHAR(100) NOT NULL,
  PRIMARY KEY (`plan_version_id`, `feature_key`),
  CONSTRAINT `platform_plan_features_plan_version_id_fkey` FOREIGN KEY (`plan_version_id`)
    REFERENCES `platform_plan_versions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `platform_plan_quotas` (
  `plan_version_id` INTEGER NOT NULL, `resource` VARCHAR(30) NOT NULL, `limit` BIGINT NULL,
  PRIMARY KEY (`plan_version_id`, `resource`),
  CONSTRAINT `platform_plan_quotas_plan_version_id_fkey` FOREIGN KEY (`plan_version_id`)
    REFERENCES `platform_plan_versions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `firm_subscriptions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `firm_id` INTEGER NOT NULL, `plan_version_id` INTEGER NOT NULL,
  `status` VARCHAR(20) NOT NULL, `effective_from` DATETIME(3) NOT NULL, `effective_until` DATETIME(3) NULL,
  `trial_ends_at` DATETIME(3) NULL, `grace_ends_at` DATETIME(3) NULL, `current_period_ends_at` DATETIME(3) NULL,
  `renewal_at` DATETIME(3) NULL, `reason` VARCHAR(500) NOT NULL, `author_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `firm_subscriptions_firm_id_effective_from_key` (`firm_id`, `effective_from`),
  INDEX `firm_subscriptions_firm_id_effective_from_effective_until_idx` (`firm_id`, `effective_from`, `effective_until`),
  PRIMARY KEY (`id`),
  CONSTRAINT `firm_subscriptions_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `firm_subscriptions_plan_version_id_fkey` FOREIGN KEY (`plan_version_id`) REFERENCES `platform_plan_versions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `firm_feature_overrides` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `firm_id` INTEGER NOT NULL, `target` VARCHAR(120) NOT NULL,
  `effect` VARCHAR(10) NOT NULL, `limit` BIGINT NULL, `reason` VARCHAR(500) NOT NULL, `author_id` INTEGER NOT NULL,
  `starts_at` DATETIME(3) NOT NULL, `expires_at` DATETIME(3) NULL, `revoked_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `firm_feature_overrides_firm_id_target_starts_at_key` (`firm_id`, `target`, `starts_at`),
  INDEX `firm_feature_overrides_firm_id_starts_at_idx` (`firm_id`, `starts_at`), PRIMARY KEY (`id`),
  CONSTRAINT `firm_feature_overrides_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `firm_usage_counters` (
  `firm_id` INTEGER NOT NULL, `resource` VARCHAR(30) NOT NULL, `used` BIGINT NOT NULL DEFAULT 0,
  `pending_delta` BIGINT NOT NULL DEFAULT 0,
  `ready` BOOLEAN NOT NULL DEFAULT true, `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`firm_id`, `resource`), CONSTRAINT `firm_usage_counters_firm_id_fkey`
    FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `firm_usage_events` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `firm_id` INTEGER NOT NULL, `resource` VARCHAR(30) NOT NULL,
  `event_id` VARCHAR(191) NOT NULL, `delta` BIGINT NOT NULL, `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `firm_usage_events_firm_id_resource_event_id_key` (`firm_id`, `resource`, `event_id`),
  INDEX `firm_usage_events_firm_id_created_at_idx` (`firm_id`, `created_at`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `platform_subscription_events` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `firm_id` INTEGER NULL, `author_id` INTEGER NOT NULL,
  `kind` VARCHAR(100) NOT NULL, `payload` JSON NOT NULL, `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `platform_subscription_events_firm_id_created_at_idx` (`firm_id`, `created_at`),
  INDEX `platform_subscription_events_kind_created_at_idx` (`kind`, `created_at`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `platform_charges` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `firm_id` INTEGER NOT NULL, `idempotency_key` VARCHAR(191) NOT NULL,
  `amount` DECIMAL(18,2) NOT NULL, `currency` CHAR(3) NOT NULL, `reason` VARCHAR(500) NOT NULL,
  `author_id` INTEGER NOT NULL, `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `platform_charges_idempotency_key_key` (`idempotency_key`),
  INDEX `platform_charges_firm_id_created_at_idx` (`firm_id`, `created_at`), PRIMARY KEY (`id`),
  CONSTRAINT `platform_charges_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `platform_payment_events` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `charge_id` INTEGER NOT NULL, `idempotency_key` VARCHAR(191) NOT NULL,
  `kind` VARCHAR(20) NOT NULL, `amount` DECIMAL(18,2) NOT NULL, `reference` VARCHAR(191) NOT NULL,
  `reason` VARCHAR(500) NOT NULL, `author_id` INTEGER NOT NULL, `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `platform_payment_events_idempotency_key_key` (`idempotency_key`),
  INDEX `platform_payment_events_charge_id_created_at_idx` (`charge_id`, `created_at`), PRIMARY KEY (`id`),
  CONSTRAINT `platform_payment_events_charge_id_fkey` FOREIGN KEY (`charge_id`) REFERENCES `platform_charges` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Revision numbers of the reserved legacy plan equal its user quota. Different
-- existing user limits retain separate immutable snapshots of the same features.
-- Actor 0 means this system migration, not an impersonated administrator.
INSERT INTO `platform_plans` (`slug`, `name`, `is_legacy`, `updated_at`)
VALUES ('legacy-compatible', 'Legacy compatible', true, CURRENT_TIMESTAMP(3));

INSERT INTO `platform_plan_versions` (`plan_id`, `revision`, `policy`, `created_by_id`)
SELECT p.id, limits.user_limit, NULL, 0
FROM `platform_plans` p CROSS JOIN (
  SELECT 4 AS user_limit UNION
  SELECT GREATEST(1, f.user_limit, (SELECT COUNT(*) FROM users u WHERE u.firm_id = f.id AND u.deleted_at IS NULL))
  FROM firms f
) limits WHERE p.slug = 'legacy-compatible';

INSERT INTO `platform_plan_features` (`plan_version_id`, `feature_key`)
SELECT v.id, features.feature_key FROM platform_plan_versions v
JOIN platform_plans p ON p.id = v.plan_id CROSS JOIN (
  SELECT 'firm.core' AS feature_key UNION ALL SELECT 'dashboard' UNION ALL SELECT 'companies'
  UNION ALL SELECT 'catalog' UNION ALL SELECT 'items' UNION ALL SELECT 'quotations'
  UNION ALL SELECT 'quotations.documents' UNION ALL SELECT 'quotations.email'
  UNION ALL SELECT 'quotations.attachments' UNION ALL SELECT 'audit'
) features WHERE p.slug = 'legacy-compatible';

INSERT INTO `platform_plan_quotas` (`plan_version_id`, `resource`, `limit`)
SELECT v.id, resources.resource,
  CASE resources.resource WHEN 'users' THEN v.revision WHEN 'aiCredits' THEN 0 ELSE NULL END
FROM platform_plan_versions v JOIN platform_plans p ON p.id = v.plan_id
CROSS JOIN (SELECT 'users' AS resource UNION ALL SELECT 'documents' UNION ALL SELECT 'storageBytes' UNION ALL SELECT 'aiCredits') resources
WHERE p.slug = 'legacy-compatible';

UPDATE platform_plan_versions v JOIN platform_plans p ON p.id = v.plan_id
SET v.published_at = CURRENT_TIMESTAMP(3) WHERE p.slug = 'legacy-compatible';

INSERT INTO `firm_subscriptions` (`firm_id`, `plan_version_id`, `status`, `effective_from`, `reason`, `author_id`)
SELECT f.id, v.id, 'ACTIVE', CURRENT_TIMESTAMP(3), 'Wave02 legacy backfill preserving existing features and permitted users', 0
FROM firms f JOIN platform_plans p ON p.slug = 'legacy-compatible'
JOIN platform_plan_versions v ON v.plan_id = p.id AND v.revision = GREATEST(1, f.user_limit,
  (SELECT COUNT(*) FROM users u WHERE u.firm_id = f.id AND u.deleted_at IS NULL));

UPDATE firms f JOIN firm_subscriptions s ON s.firm_id = f.id
JOIN platform_plan_versions v ON v.id = s.plan_version_id SET f.user_limit = v.revision;

INSERT INTO `firm_usage_counters` (`firm_id`, `resource`, `used`, `ready`, `updated_at`)
SELECT f.id, resources.resource, CASE resources.resource
  WHEN 'users' THEN (SELECT COUNT(*) FROM users u WHERE u.firm_id = f.id AND u.deleted_at IS NULL)
  WHEN 'documents' THEN (SELECT COUNT(*) FROM generated_documents d JOIN quotations q ON q.id = d.quotation_id WHERE q.firm_id = f.id)
  ELSE 0 END, resources.resource <> 'storageBytes', CURRENT_TIMESTAMP(3)
FROM firms f CROSS JOIN (SELECT 'users' AS resource UNION ALL SELECT 'documents' UNION ALL SELECT 'storageBytes' UNION ALL SELECT 'aiCredits') resources;

INSERT INTO `firm_usage_events` (`firm_id`, `resource`, `event_id`, `delta`)
SELECT firm_id, resource, 'wave02:legacy-baseline', used FROM firm_usage_counters WHERE ready = true;

INSERT INTO `platform_subscription_events` (`firm_id`, `author_id`, `kind`, `payload`)
SELECT s.firm_id, 0, 'LEGACY_BACKFILL', JSON_OBJECT('subscriptionId', s.id, 'planVersionId', s.plan_version_id, 'userLimit', v.revision, 'storageReconciliationPending', true)
FROM firm_subscriptions s JOIN platform_plan_versions v ON v.id = s.plan_version_id;

-- Application writers use the same firm row lock for counter/resource changes.
-- Database immutability also protects history from accidental direct writes.
CREATE TRIGGER `wave02_published_version_update` BEFORE UPDATE ON `platform_plan_versions` FOR EACH ROW
BEGIN
  IF OLD.published_at IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Published plan revisions are immutable'; END IF;
END;
CREATE TRIGGER `wave02_published_version_delete` BEFORE DELETE ON `platform_plan_versions` FOR EACH ROW
BEGIN
  IF OLD.published_at IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Published plan revisions are immutable'; END IF;
END;
CREATE TRIGGER `wave02_plan_feature_insert` BEFORE INSERT ON `platform_plan_features` FOR EACH ROW
BEGIN
  IF (SELECT published_at FROM platform_plan_versions WHERE id = NEW.plan_version_id) IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Published plan features are immutable'; END IF;
END;
CREATE TRIGGER `wave02_plan_feature_update` BEFORE UPDATE ON `platform_plan_features` FOR EACH ROW
BEGIN
  IF (SELECT published_at FROM platform_plan_versions WHERE id = OLD.plan_version_id) IS NOT NULL OR (SELECT published_at FROM platform_plan_versions WHERE id = NEW.plan_version_id) IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Published plan features are immutable'; END IF;
END;
CREATE TRIGGER `wave02_plan_feature_delete` BEFORE DELETE ON `platform_plan_features` FOR EACH ROW
BEGIN
  IF (SELECT published_at FROM platform_plan_versions WHERE id = OLD.plan_version_id) IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Published plan features are immutable'; END IF;
END;
CREATE TRIGGER `wave02_plan_quota_insert` BEFORE INSERT ON `platform_plan_quotas` FOR EACH ROW
BEGIN
  IF (SELECT published_at FROM platform_plan_versions WHERE id = NEW.plan_version_id) IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Published plan quotas are immutable'; END IF;
END;
CREATE TRIGGER `wave02_plan_quota_update` BEFORE UPDATE ON `platform_plan_quotas` FOR EACH ROW
BEGIN
  IF (SELECT published_at FROM platform_plan_versions WHERE id = OLD.plan_version_id) IS NOT NULL OR (SELECT published_at FROM platform_plan_versions WHERE id = NEW.plan_version_id) IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Published plan quotas are immutable'; END IF;
END;
CREATE TRIGGER `wave02_plan_quota_delete` BEFORE DELETE ON `platform_plan_quotas` FOR EACH ROW
BEGIN
  IF (SELECT published_at FROM platform_plan_versions WHERE id = OLD.plan_version_id) IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Published plan quotas are immutable'; END IF;
END;
CREATE TRIGGER `wave02_usage_event_update` BEFORE UPDATE ON `firm_usage_events` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Usage events are append only';
CREATE TRIGGER `wave02_usage_event_delete` BEFORE DELETE ON `firm_usage_events` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Usage events are append only';
CREATE TRIGGER `wave02_subscription_event_update` BEFORE UPDATE ON `platform_subscription_events` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Subscription events are append only';
CREATE TRIGGER `wave02_subscription_event_delete` BEFORE DELETE ON `platform_subscription_events` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Subscription events are append only';
CREATE TRIGGER `wave02_charge_update` BEFORE UPDATE ON `platform_charges` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Platform charges are append only';
CREATE TRIGGER `wave02_charge_delete` BEFORE DELETE ON `platform_charges` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Platform charges are append only';
CREATE TRIGGER `wave02_payment_update` BEFORE UPDATE ON `platform_payment_events` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment events are append only';
CREATE TRIGGER `wave02_payment_delete` BEFORE DELETE ON `platform_payment_events` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment events are append only';
