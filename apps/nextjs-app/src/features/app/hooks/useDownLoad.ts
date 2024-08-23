import { useCallback, useEffect, useRef } from 'react';

interface IDownloadProps {
  downloadUrl: string;
}

const DEFAULT_DOWNLOAD_IFRAME_ID = 'teable_download_iframe_id';

export const useDownload = ({ downloadUrl }: IDownloadProps) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const target = document.getElementById(DEFAULT_DOWNLOAD_IFRAME_ID);
    if (target && target instanceof HTMLIFrameElement) {
      iframeRef.current = target;
      return;
    }
    const iframe = document.createElement('iframe');
    iframe.id = DEFAULT_DOWNLOAD_IFRAME_ID;
    iframe.style.display = 'none';
    iframe.title = 'This is for download';
    document.body.appendChild(iframe);
    iframeRef.current = iframe;

    return () => {
      iframeRef.current && document.body.removeChild(iframeRef.current);
    };
  }, []);

  const trigger = useCallback(() => {
    if (iframeRef.current) {
      iframeRef.current.src = downloadUrl;
      setTimeout(() => {
        iframeRef?.current && (iframeRef.current.src = '');
      }, 1000);
    }
  }, [downloadUrl]);

  return { trigger };
};
