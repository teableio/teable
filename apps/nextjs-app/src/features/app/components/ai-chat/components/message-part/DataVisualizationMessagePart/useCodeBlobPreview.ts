import { useEffect, useState } from 'react';

export const useCodeBlobPreview = (fileCode?: string) => {
  const [src, setSrc] = useState<string>();

  useEffect(() => {
    let currentSrc: string;
    if (fileCode) {
      const blob = new Blob([fileCode], { type: 'text/html;charset=utf-8' });
      currentSrc = URL.createObjectURL(blob);
      setSrc(currentSrc);
    }
    return () => {
      if (currentSrc) {
        URL.revokeObjectURL(currentSrc);
      }
    };
  }, [fileCode]);

  return src;
};
