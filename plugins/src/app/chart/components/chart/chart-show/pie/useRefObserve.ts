import { useEffect, useRef, useState } from 'react';

export const useRefObserve = () => {
  const ref = useRef<SVGTextElement>(null);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const currentElement = ref.current;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
        setHeight(entry.contentRect.height);
      }
    });

    if (currentElement) {
      const { width, height } = currentElement.getBoundingClientRect();
      setWidth(width);
      setHeight(height);
      observer.observe(currentElement);
    }
    return () => {
      if (currentElement) {
        observer.unobserve(currentElement);
      }
    };
  }, []);
  return [
    ref,
    {
      width,
      height,
    },
  ] as const;
};
