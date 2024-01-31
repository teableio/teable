import { useIsTouchDevice } from '@teable/sdk/hooks';
import { useEffect, type FC, type PropsWithChildren } from 'react';
import { MainLayout } from '@/components/layout';

export const AppLayout: FC<PropsWithChildren> = (props) => {
  const { children } = props;

  // Determine whether it is a touch device
  const isTouchDevice = useIsTouchDevice();

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
