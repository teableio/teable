import { FieldContext, ViewContext } from '@teable-group/sdk/context';
import type { IFieldInstance, IViewInstance } from '@teable-group/sdk/model';
import type { FC, PropsWithChildren } from 'react';
import { I18nextTestStubProvider } from './I18nextTestStubProvider';

export const AppTestProviders: FC<PropsWithChildren> = ({ children }) => {
  return <I18nextTestStubProvider>{children}</I18nextTestStubProvider>;
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
