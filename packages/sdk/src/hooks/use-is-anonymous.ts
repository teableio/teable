import { isAnonymous } from '@teable/core';
import { useSession } from './use-session';

export const useIsAnonymous = () => {
  const { user } = useSession();
  return isAnonymous(user?.id);
};
