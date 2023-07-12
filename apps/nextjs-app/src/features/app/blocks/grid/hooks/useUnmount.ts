import { useRef, useEffect } from 'react';

export const useUnmount = (fn: () => void): void => {
  const fnRef = useRef(fn);

  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  useEffect(() => {
    return () => {
      if (fnRef.current) fnRef.current();
    };
  }, []);
};
