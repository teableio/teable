import type { FC, PropsWithChildren } from 'react';
import { useEffect, useState } from 'react';
// import { MainLayout } from '@/components/layout';

export const AppLayout: FC<PropsWithChildren> = (props) => {
  const { children } = props;
  const [isHydrated, setIsHydrated] = useState(false);
  // Wait till NextJS rehydration completes, then show the app
  // otherwise there will be throw an error
  // https://github.com/pmndrs/zustand/issues/1145#issuecomment-1304856686
  useEffect(() => {
    setIsHydrated(true);
  }, []);
  return (
    <div>{isHydrated ? <div>{children}</div> : <div>Loading...</div>}</div>
  );
};
