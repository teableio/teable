import type { IAppContext } from '@teable/sdk/context';
import { AppContext, FieldContext, TableContext, ViewContext } from '@teable/sdk/context';
import { defaultLocale } from '@teable/sdk/context/app/i18n';
import type { IFieldInstance, IViewInstance } from '@teable/sdk/model';
import type { FC, PropsWithChildren } from 'react';
import { I18nextTestStubProvider } from './I18nextTestStubProvider';

export const createAppContext = (context: Partial<IAppContext> = {}) => {
  const defaultContext: IAppContext = {
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
    <TableContext.Provider value={{ tables: [] }}>
      <ViewContext.Provider value={{ views }}>
        <FieldContext.Provider value={{ fields }}>{children}</FieldContext.Provider>
      </ViewContext.Provider>
    </TableContext.Provider>
  );
};
