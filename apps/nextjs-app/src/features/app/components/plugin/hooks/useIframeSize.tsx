import { useEffect, useRef, useState } from 'react';

export const useIframeSize = (dragging?: boolean) => {
  const ref = useRef<HTMLDivElement>(null);
  const [preSize, setPreSize] = useState({ width: 0, height: 0 });
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (dragging) {
      return;
    }
    setPreSize(size);
  }, [dragging, size]);

  useEffect(() => {
    const currentElement = ref.current;

    const observer = new ResizeObserver(() => {
      if (currentElement) {
        const { width, height } = currentElement.getBoundingClientRect();
        setSize({ width, height });
        observer.observe(currentElement);
      }
    });
    if (currentElement) {
      const { width, height } = currentElement.getBoundingClientRect();
      setSize({ width, height });
      observer.observe(currentElement);
    }
    return () => {
      if (currentElement) {
        observer.unobserve(currentElement);
      }
    };
  }, [ref]);

  return [ref, dragging ? preSize : size] as const;
};
