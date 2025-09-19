import { useEffect, useState } from 'react';

const getVisible = () => {
  if (typeof window !== 'undefined' && window.document) {
    return document.visibilityState;
  }
  return 'visible';
};

export const useDocumentVisible = () => {
  const [visible, setVisible] = useState(getVisible());

  useEffect(() => {
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
