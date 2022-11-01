import type { Session } from 'next-auth';
import type { FC, PropsWithChildren } from 'react';
import { AppProviders } from '../../src/AppProviders';
import { I18nextTestStubProvider } from './I18nextTestStubProvider';

const fakeNextAuthSession: Session = {
  user: {
    email: 'test@example.com',
    role: 'guest',
    name: 'AppTestProvider',
  },
  expires: '2050-01-01T00:00:00.000Z',
};

export const AppTestProviders: FC<PropsWithChildren> = ({ children }) => {
  return (
    <AppProviders session={fakeNextAuthSession}>
      <I18nextTestStubProvider>{children}</I18nextTestStubProvider>
    </AppProviders>
  );
};
