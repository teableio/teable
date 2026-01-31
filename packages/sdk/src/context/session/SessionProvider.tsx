import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAnonymous } from '@teable/core';
import { updateUserLang, userMe } from '@teable/openapi';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../app/i18n';
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
  const { lang } = useTranslation();
  const queryClient = useQueryClient();
  const [currentUser, setCurrentUser] = useState<IUser | undefined>(() => {
    if (user) {
      return user;
    }
    return undefined;
  });

  const { mutateAsync: updateLang } = useMutation({
    mutationFn: (ro: { lang: string }) => updateUserLang(ro),
  });

  const { data: userQuery } = useQuery({
    queryKey: ['user-me'],
    queryFn: () => userMe().then((res) => res.data),
    enabled: !disabledApi,
  });

  // Handle onSuccess logic after data is fetched (v5 migration)
  useEffect(() => {
    if (userQuery && !userQuery.lang && lang && !isAnonymous(userQuery.id)) {
      updateLang({ lang });
    }
  }, [userQuery, lang, updateLang]);

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
