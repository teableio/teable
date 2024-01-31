import { useMutation } from '@tanstack/react-query';
import { userMe } from '@teable/openapi';
import { useCallback, useMemo, useState } from 'react';
import type { IUser } from './SessionContext';
import { SessionContext } from './SessionContext';

interface ISessionProviderProps {
  user?: IUser;
}

declare global {
  interface Window {
    __s: {
      user?: IUser;
      driver: string;
    };
  }
}

export const SessionProvider: React.FC<React.PropsWithChildren<ISessionProviderProps>> = (
  props
) => {
  const { user, children } = props;
  const [currentUser, setCurrentUser] = useState<IUser | undefined>(() => {
    if (user) {
      return user;
    }
    if (typeof window === 'object') {
      return window.__s.user;
    }
    return undefined;
  });

  const { mutateAsync: getUser } = useMutation({ mutationFn: userMe });

  const refresh = useCallback(async () => {
    const { data } = await getUser();
    setCurrentUser(data);
    return data;
  }, [getUser]);

  const refreshAvatar = useCallback(async () => {
    if (currentUser?.avatar) {
      // Since the avatar url remains the same,
      // you need to add v to trigger the img tag to be re-requested
      const url = new URL(currentUser.avatar);
      const v = url.searchParams.get('v') ?? '0';
      url.searchParams.set('v', `${parseInt(v) + 1}`);
      setCurrentUser({
        ...currentUser,
        avatar: url.href,
      });
      return;
    }
    refresh?.();
  }, [currentUser, refresh]);

  const value = useMemo(
    () => ({ user: currentUser, refresh, refreshAvatar }),
    [currentUser, refresh, refreshAvatar]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};
