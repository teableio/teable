import { useEffect, useState } from 'react';

const getIsIframe = () => {
  try {
    return window.self !== window.top;
  } catch (e) {
    return true;
  }
};

export const useIsInIframe = () => {
  const [isInIframe, setIsInIframe] = useState(getIsIframe);

  useEffect(() => {
    setIsInIframe(getIsIframe());
  }, []);
  return isInIframe;
};
