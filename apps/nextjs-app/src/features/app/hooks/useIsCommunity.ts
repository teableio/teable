import { useEnv } from './useEnv';

export const useIsCommunity = () => {
  const { edition } = useEnv();

  return edition?.toUpperCase() != 'EE' && edition?.toUpperCase() != 'CLOUD';
};
