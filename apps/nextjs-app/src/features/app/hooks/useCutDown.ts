import { useEffect, useState } from 'react';

export const useCutDown = (initialCountdown: number = 0) => {
  const [countdown, setCountdown] = useState<number>(initialCountdown);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  return {
    countdown,
    setCountdown,
  };
};
