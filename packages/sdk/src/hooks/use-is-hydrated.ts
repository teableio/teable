import { useEffect, useState } from 'react';

// Wait till NextJS rehydration completes, then show the app
// otherwise there my be throw an error
export function useIsHydrated() {
  const [isHydrated, setIsHydrated] = useState(false);
  useEffect(() => {
    setIsHydrated(true);
  }, []);
  return isHydrated;
}
