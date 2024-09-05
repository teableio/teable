import { useEffect, useState } from 'react';

export function useModKeyStr() {
  const [modKeyStr, setModKeyStr] = useState('');
  useEffect(() => {
    if (typeof navigator !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const platform = navigator.platform || (navigator as any).userAgentData?.platform || '';
      const key = /^Mac/i.test(platform) ? '⌘' : 'Ctrl';
      setModKeyStr(key);
    }
  }, []);
  return modKeyStr;
}
