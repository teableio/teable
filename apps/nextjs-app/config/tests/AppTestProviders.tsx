import type { FC, PropsWithChildren } from 'react';
import { I18nextTestStubProvider } from './I18nextTestStubProvider';

export const AppTestProviders: FC<PropsWithChildren> = ({ children }) => {
  return <I18nextTestStubProvider>{children}</I18nextTestStubProvider>;
};
