import { useMedia } from 'react-use';

export const useIsMobile = () => {
  return useMedia('(min-width: 640px)');
};
