import { BillingProductLevel } from '@teable/openapi';
import { useUpgradeAction } from '@/features/app/components/billing/UpgradeWrapper';
import type { useBaseUsage } from './useBaseUsage';

// Archive is a paid feature: paid tiers get the working entry, lower EE/cloud tiers see
// it with an upgrade badge as an upsell, and community (where needsUpgrade is always
// false and usage is never fetched) stays hidden. Callers AND `archiveUnlocked` with
// their surface-specific permission check.
export const useArchiveUpsell = (usage: ReturnType<typeof useBaseUsage>) => {
  const { badge, needsUpgrade, handleUpgradeClick } = useUpgradeAction({
    targetBillingLevel: BillingProductLevel.Business,
  });
  return {
    archiveUnlocked: Boolean(usage?.limit?.archiveEnable || needsUpgrade),
    badge,
    needsUpgrade,
    handleUpgradeClick,
  };
};
