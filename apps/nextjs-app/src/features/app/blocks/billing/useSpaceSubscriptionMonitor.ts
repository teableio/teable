import type { BillingProductLevel } from '@teable/openapi';
import { useRouter } from 'next/router';
import { useMount } from 'react-use';
import { useUpgradeCtaEnabled } from '../../hooks/useUpgradeCtaEnabled';
import { useSpaceSubscriptionStore } from './useSpaceSubscriptionStore';

export const useSpaceSubscriptionMonitor = () => {
  const router = useRouter();
  const { subscribeLevel } = router.query as { subscribeLevel?: BillingProductLevel };
  const { openModal } = useSpaceSubscriptionStore();
  const upgradeCtaEnabled = useUpgradeCtaEnabled();
  useMount(() => {
    // `?subscribeLevel=` opens the plan picker: not inside the native mobile WebView.
    if (subscribeLevel && upgradeCtaEnabled) {
      openModal(subscribeLevel);
      router.push(router.pathname, undefined, { shallow: true });
    }
  });
};
