import { useRouter } from 'next/router';
import { useMount } from 'react-use';
import { useTemplateCreateBaseStore } from './useTemplateCreateBaseStore';

export const useTemplateMonitor = () => {
  const router = useRouter();
  const { tid, action, spaceId } = router.query as {
    tid: string;
    action: string;
    spaceId?: string;
  };
  const { openModal } = useTemplateCreateBaseStore();

  useMount(() => {
    if (action === 'createFromTemplate' && tid && spaceId) {
      openModal(tid, spaceId);
      // Clear URL params while preserving spaceId
      router.push(
        {
          pathname: router.pathname,
          query: { spaceId },
        },
        undefined,
        { shallow: true }
      );
    }
  });
};
