import { useCallback, useMemo, useState } from 'react';
import { useMutation } from 'react-query';
import { AuthApi } from '../../api';
import type { IUser } from './SessionContext';
import { SessionContext } from './SessionContext';

interface ISessionProviderProps {
  user?: IUser;
}

export const SessionProvider: React.FC<React.PropsWithChildren<ISessionProviderProps>> = (
  props
) => {
  const { user, children } = props;
  const [currentUser, setCurrentUser] = useState<IUser | undefined>(user);

  const { mutateAsync: getUser } = useMutation({ mutationFn: AuthApi.userMe });

  const refresh = useCallback(async () => {
    const { data } = await getUser();
    setCurrentUser(data);
    return data;
  }, [getUser]);

  const value = useMemo(() => ({ user: currentUser, refresh }), [currentUser, refresh]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};
