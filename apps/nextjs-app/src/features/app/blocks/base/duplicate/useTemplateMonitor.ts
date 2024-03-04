import { useRouter } from 'next/router';
import { useMount } from 'react-use';
import { useTemplateCreateBaseStore } from './useTemplateCreateBaseStore';

export const useTemplateMonitor = () => {
  const router = useRouter();
  const { tid, action } = router.query as { tid: string; action: string };
  const { openModal } = useTemplateCreateBaseStore();
  useMount(() => {
    if (action === 'createFromTemplate' && tid) {
      openModal(tid);
      router.push(router.pathname, undefined, { shallow: true });
    }
  });
};
