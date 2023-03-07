import type { FC, PropsWithChildren } from 'react';
import { MainLayout } from '@/components/layout';

export const AppLayout: FC<PropsWithChildren> = (props) => {
  const { children } = props;
  return <MainLayout>{children}</MainLayout>;
};
