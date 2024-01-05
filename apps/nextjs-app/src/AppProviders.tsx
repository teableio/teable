import { Toaster as SoonerToaster } from '@teable-group/ui-lib/shadcn/ui/sonner';
import { Toaster } from '@teable-group/ui-lib/shadcn/ui/toaster';
import type { FC, PropsWithChildren } from 'react';

type Props = PropsWithChildren;

export const AppProviders: FC<Props> = (props) => {
  const { children } = props;
  return (
    <>
      {children}
      <Toaster />
      <SoonerToaster />
    </>
  );
};
