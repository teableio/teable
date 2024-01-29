import type { DriverClient } from '@teable-group/core';
import type { IAppContext } from '@teable-group/sdk/context';
import { AppContext, FieldContext, ThemeKey, ViewContext } from '@teable-group/sdk/context';
import { defaultLocale } from '@teable-group/sdk/context/app/i18n';
import type { IFieldInstance, IViewInstance } from '@teable-group/sdk/model';
import { noop } from 'lodash';
import type { FC, PropsWithChildren } from 'react';
import { I18nextTestStubProvider } from './I18nextTestStubProvider';

export const createAppContext = (context: Partial<IAppContext> = {}) => {
  const defaultContext: IAppContext = {
    driver: 'sqlite3' as DriverClient,
    connected: false,
    theme: ThemeKey.Dark,
    isAutoTheme: false,
    setTheme: noop,
    locale: defaultLocale,
  };
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.ReactNode }) => (
    <AppContext.Provider value={{ ...defaultContext, ...context }}>{children}</AppContext.Provider>
  );
};

const MockProvider = createAppContext();

export const AppTestProviders: FC<PropsWithChildren> = ({ children }) => {
  return (
    <I18nextTestStubProvider>
      <MockProvider>{children}</MockProvider>
    </I18nextTestStubProvider>
  );
};

export const TestAnchorProvider: FC<
  PropsWithChildren & {
    fields?: IFieldInstance[];
    views?: IViewInstance[];
  }
> = ({ children, fields = [], views = [] }) => {
  return (
    <ViewContext.Provider value={{ views }}>
      <FieldContext.Provider value={{ fields }}>{children}</FieldContext.Provider>
    </ViewContext.Provider>
  );
};
