export { FEATURE_KEYS, FEATURE_REGISTRY, QUOTA_KEYS, PERMISSION_FEATURES, isFeatureKey, validateFeatureSelection } from './feature-registry.js';
export type { FeatureKey, QuotaKey } from './feature-registry.js';
export { subscriptionPolicySchema, LEGACY_POLICY } from './entitlements.schema.js';
export { assertFeatureEntitlements, assertTransactionFeature, getFirmEntitlements, loadEntitlements, lockEntitlementFirm, withFirmEntitlementTransaction, recordUsage, reconcileFirmUsage, storageFileBytes } from './entitlements.repository.js';
export type { EntitlementTransaction } from './entitlements.repository.js';
export { initializeLegacySubscription } from './entitlements.repository.js';
export { prepareStorageUsage, recordStorageReplacement } from './entitlements.repository.js';
