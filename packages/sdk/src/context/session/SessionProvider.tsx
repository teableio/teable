import { useMutation } from '@tanstack/react-query';
import { userMe } from '@teable-group/openapi';
import { useCallback, useMemo, useState } from 'react';
import type { IUser } from './SessionContext';
import { SessionContext } from './SessionContext';

interface ISessionProviderProps {
  user?: IUser;
}

declare let window: {
  __user: IUser;
};

export const SessionProvider: React.FC<React.PropsWithChildren<ISessionProviderProps>> = (
  props
) => {
  const { user, children } = props;
  const [currentUser, setCurrentUser] = useState<IUser | undefined>(() => {
    if (user) {
      return user;
    }
    if (typeof window === 'object') {
      return window.__user;
    }
    return undefined;
  });

  const { mutateAsync: getUser } = useMutation({ mutationFn: userMe });

  const refresh = useCallback(async () => {
    const { data } = await getUser();
    setCurrentUser(data);
    return data;
  }, [getUser]);

  const value = useMemo(() => ({ user: currentUser, refresh }), [currentUser, refresh]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};
