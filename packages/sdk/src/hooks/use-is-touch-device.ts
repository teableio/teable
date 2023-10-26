import { useMedia } from 'react-use';

export const useIsTouchDevice = () => {
  return useMedia('(pointer: coarse)');
};
