import Mousetrap from 'mousetrap';
import type { ExtendedKeyboardEvent } from 'mousetrap';
import { useEffect, useState } from 'react';

export const useKeyboardNavigation = (size: number, isEditing?: boolean) => {
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    !isEditing && setActiveIndex(-1);
  }, [isEditing]);

  useEffect(() => {
    const mousetrap = new Mousetrap();
    mousetrap.stopCallback = () => {
      if (isEditing === undefined) return true;
      return !isEditing;
    };

    const onIndexUpdate = (event: ExtendedKeyboardEvent, combo: string) => {
      if (combo === 'up') {
        event.preventDefault();
        setActiveIndex((prevIndex) => (prevIndex <= 0 ? size - 1 : prevIndex - 1));
      } else if (combo === 'down') {
        event.preventDefault();
        setActiveIndex((prevIndex) => (prevIndex >= size - 1 ? 0 : prevIndex + 1));
      }
    };

    mousetrap.bind(['up', 'down'], onIndexUpdate);

    return () => {
      mousetrap.reset();
    };
  }, [activeIndex, size, isEditing]);

  return activeIndex;
};
