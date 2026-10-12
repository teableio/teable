import { BillingProductLevel } from '@teable/openapi';
import { useUpgradeAction } from '@/features/app/components/billing/UpgradeWrapper';
import type { useBaseUsage } from './useBaseUsage';

// Archive is a paid feature: paid tiers get the working entry, lower EE/cloud tiers see
// it with an upgrade badge as an upsell, and community (where needsUpgrade is always
// false and usage is never fetched) stays hidden. Inside the native mobile WebView the
// upsell entry is hidden too (no upgrade CTAs there). Callers AND `archiveUnlocked`
// with their surface-specific permission check.
export const useArchiveUpsell = (usage: ReturnType<typeof useBaseUsage>) => {
  const { badge, needsUpgrade, handleUpgradeClick, upgradeCtaEnabled } = useUpgradeAction({
    targetBillingLevel: BillingProductLevel.Business,
  });
  return {
    archiveUnlocked: Boolean(usage?.limit?.archiveEnable || (needsUpgrade && upgradeCtaEnabled)),
    badge,
    needsUpgrade,
    handleUpgradeClick,
  };
};
