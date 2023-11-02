'use client';

import 'nprogress/nprogress.css';
import { useRouter } from 'next/router';
import NProgress from 'nprogress';
import { useEffect } from 'react';

NProgress.configure({ showSpinner: false });

export default function RouterProgressBar() {
  const router = useRouter();

  useEffect(() => {
    const handleStart = () => NProgress.start();
    const handleStop = () => NProgress.done();

    router.events.on('routeChangeStart', handleStart);
    router.events.on('routeChangeComplete', handleStop);
    router.events.on('routeChangeError', handleStop);

    return () => {
      router.events.off('routeChangeStart', handleStart);
      router.events.off('routeChangeComplete', handleStop);
      router.events.off('routeChangeError', handleStop);
    };
  }, [router.events]);

  return (
    <style>
      {`
        #nprogress .bar {
          height: 2px;
        }
     `}
    </style>
  );
}
