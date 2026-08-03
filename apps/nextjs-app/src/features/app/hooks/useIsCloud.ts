import { useEnv } from './useEnv';

export const useIsCloud = () => {
  const { edition } = useEnv();

  return edition?.toUpperCase() === 'CLOUD';
};
