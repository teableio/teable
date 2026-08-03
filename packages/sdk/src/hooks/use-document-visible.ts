import { useEffect, useState } from 'react';

const isBrowser = () => typeof window !== 'undefined' && window.document;

const getVisible = () => {
  if (isBrowser()) {
    return document.visibilityState;
  }
  return 'visible';
};

export const useDocumentVisible = () => {
  const [visible, setVisible] = useState(getVisible());

  useEffect(() => {
    if (!isBrowser()) {
      return;
    }
    const handler = () => {
      setVisible(getVisible());
    };
    document.addEventListener('visibilitychange', handler);
    return () => {
      document.removeEventListener('visibilitychange', handler);
    };
  }, []);
  return visible === 'visible';
};
