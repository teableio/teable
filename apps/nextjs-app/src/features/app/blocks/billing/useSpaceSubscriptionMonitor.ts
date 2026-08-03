import type { BillingProductLevel } from '@teable/openapi';
import { useRouter } from 'next/router';
import { useMount } from 'react-use';
import { useSpaceSubscriptionStore } from './useSpaceSubscriptionStore';

export const useSpaceSubscriptionMonitor = () => {
  const router = useRouter();
  const { subscribeLevel } = router.query as { subscribeLevel?: BillingProductLevel };
  const { openModal } = useSpaceSubscriptionStore();
  useMount(() => {
    if (subscribeLevel) {
      openModal(subscribeLevel);
      router.push(router.pathname, undefined, { shallow: true });
    }
  });
};
