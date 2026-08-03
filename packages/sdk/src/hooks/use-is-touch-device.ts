import { useMedia } from 'react-use';
import { InteractionMode, useInteractionModeStore } from '../store';

export const useIsTouchDevice = () => {
  const isTouchDevice = useMedia('(pointer: coarse)');
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
