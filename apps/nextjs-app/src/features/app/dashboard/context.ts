import { createContext, useContext } from 'react';

interface IDashboardContext {
  chatComponent?: React.ReactNode;
}

export const DashboardContext = createContext<IDashboardContext>({
  chatComponent: null,
});

export const useDashboardContext = () => {
  return useContext(DashboardContext);
};
