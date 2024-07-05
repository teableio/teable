import { useEnv } from './useEnv';

export const useIsEE = () => {
  const { edition } = useEnv();

  return edition?.toUpperCase() === 'EE';
};
