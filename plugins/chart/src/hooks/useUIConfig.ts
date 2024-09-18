import { useContext, useMemo } from 'react';
import { ChartContext } from '../components/ChartProvider';

export const useUIConfig = () => {
  const { uiConfig } = useContext(ChartContext);
  return useMemo(() => uiConfig ?? {}, [uiConfig]);
};
