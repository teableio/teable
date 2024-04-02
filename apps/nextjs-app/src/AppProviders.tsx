import { Toaster as SoonerToaster } from '@teable/ui-lib/shadcn/ui/sonner';
import { Toaster } from '@teable/ui-lib/shadcn/ui/toaster';
import type { FC, PropsWithChildren } from 'react';
import type { IServerEnv } from './lib/server-env';
import { EnvContext } from './lib/server-env';

type Props = PropsWithChildren;

export const AppProviders: FC<Props & { env: IServerEnv }> = (props) => {
  const { children, env } = props;

  return (
    <EnvContext.Provider value={env}>
      {children}
      <Toaster />
      <SoonerToaster />
    </EnvContext.Provider>
  );
};
