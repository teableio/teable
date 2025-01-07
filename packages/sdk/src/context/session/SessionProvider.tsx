import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { userMe } from '@teable/openapi';
import { useCallback, useMemo, useState } from 'react';
import type { IUser } from './SessionContext';
import { SessionContext } from './SessionContext';

interface ISessionProviderProps {
  user?: IUser;
  disabledApi?: boolean;
  fallback?: React.ReactNode;
}

export const SessionProvider: React.FC<React.PropsWithChildren<ISessionProviderProps>> = (
  props
) => {
  const { user, fallback, children, disabledApi = false } = props;
  const queryClient = useQueryClient();
  const [currentUser, setCurrentUser] = useState<IUser | undefined>(() => {
    if (user) {
      return user;
    }
    return undefined;
  });

  const { data: userQuery } = useQuery({
    queryKey: ['user-me'],
    queryFn: () => userMe().then((res) => res.data),
    enabled: !disabledApi,
  });
  const { mutateAsync: getUser } = useMutation({ mutationFn: userMe });

  const refresh = useCallback(async () => {
    const { data } = await getUser();
    queryClient.invalidateQueries({ queryKey: ['user-me'] });
    setCurrentUser(data);
    return data;
  }, [getUser, queryClient]);

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
    refresh();
  }, [currentUser, refresh]);

  const value = useMemo(
    () => ({
      user: {
        ...(userQuery ?? {}),
        ...(currentUser ?? {}),
      } as IUser,
      refresh,
      refreshAvatar,
    }),
    [currentUser, userQuery, refresh, refreshAvatar]
  );

  if (!value.user) {
    return <>{fallback}</>;
  }

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};
