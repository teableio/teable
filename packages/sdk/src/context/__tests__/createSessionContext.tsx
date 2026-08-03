import { noop } from 'lodash';
import { SessionContext, type ISessionContext } from '../session';

export const createSessionContext = (context: Partial<ISessionContext> = {}) => {
  const defaultContext: ISessionContext = {
    refresh: noop,
    refreshAvatar: noop,
    user: {
      id: 'usrxxxxxx',
      name: 'teable',
      email: 'example@teable.ai',
      notifyMeta: {},
      hasPassword: true,
    },
  };
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.ReactNode }) => (
    <SessionContext.Provider value={{ ...defaultContext, ...context }}>
      {children}
    </SessionContext.Provider>
  );
};
