import type { IAppContext } from '../app/AppContext';
import { AppContext } from '../app/AppContext';
import { defaultLocale } from '../app/i18n';

export const createAppContext = (context: Partial<IAppContext> = {}) => {
  const defaultContext: IAppContext = {
    locale: defaultLocale,
  };
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.ReactNode }) => (
    <AppContext.Provider value={{ ...defaultContext, ...context }}>{children}</AppContext.Provider>
  );
};
