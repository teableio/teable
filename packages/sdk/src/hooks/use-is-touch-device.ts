/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo } from 'react';
import { useMedia } from 'react-use';

export const useIsTouchDevice = () => {
  const isTouchDeviceByMedia = useMedia('(pointer: coarse)');
  return useMemo(() => {
    return (
      !!(
        typeof window !== 'undefined' &&
        ('ontouchstart' in window ||
          ((window as any).DocumentTouch &&
            typeof document !== 'undefined' &&
            document instanceof (window as any).DocumentTouch))
      ) || isTouchDeviceByMedia
    );
  }, [isTouchDeviceByMedia]);
};
