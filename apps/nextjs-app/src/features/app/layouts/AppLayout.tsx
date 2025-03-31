import { generateWindowId } from '@teable/core';
import { axios } from '@teable/openapi';
import { useIsTouchDevice } from '@teable/sdk/hooks';
import { useEffect, type FC, type PropsWithChildren } from 'react';
import { useMount } from 'react-use';
import { MainLayout } from '@/components/layout';
import { useAutoFavicon } from '../hooks/useAutoFavicon';

export const AppLayout: FC<PropsWithChildren> = (props) => {
  const { children } = props;

  // Determine whether it is a touch device
  const isTouchDevice = useIsTouchDevice();
  useAutoFavicon();

  useMount(() => {
    const windowId = generateWindowId();
    axios.interceptors.request.use((config) => {
      config.headers['X-Window-Id'] = windowId;
      return config;
    });
  });

  // Solve the problem that the page will be pushed up after the input is focused on touch devices
  useEffect(() => {
    if (!isTouchDevice) return;

    const onFocusout = () => {
      setTimeout(() => window.scrollTo({ top: 0, left: 0, behavior: 'smooth' }));
    };
    document.body.addEventListener('focusout', onFocusout);
    return () => document.body.removeEventListener('focusout', onFocusout);
  }, [isTouchDevice]);

  return <MainLayout>{children}</MainLayout>;
};
