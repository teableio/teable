import { useMedia } from 'react-use';
import { InteractionMode, useInteractionModeStore } from '../store';

export const useIsTouchDevice = () => {
  // `defaultState` must be explicit: react-use logs an SSR warning (and can
  // mismatch on hydration) when the server-rendered value is undefined.
  const isTouchDevice = useMedia('(pointer: coarse)', false);
  const { interactionMode: interactionType } = useInteractionModeStore();

  switch (interactionType) {
    case InteractionMode.Touch:
      return true;
    case InteractionMode.Mouse:
      return false;
    default:
      return isTouchDevice;
  }
};
