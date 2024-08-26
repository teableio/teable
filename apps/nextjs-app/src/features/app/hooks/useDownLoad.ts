import { useCallback, useEffect, useRef } from 'react';

interface IDownloadProps {
  downloadUrl: string;
  key?: string;
}

const DEFAULT_DOWNLOAD_IFRAME_ID = 'teable_download_iframe_id';

export const useDownload = ({ downloadUrl, key }: IDownloadProps) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const target = document.getElementById(`${DEFAULT_DOWNLOAD_IFRAME_ID}_${key}`);
    if (target && target instanceof HTMLIFrameElement) {
      iframeRef.current = target;
      return;
    }
    const iframe = document.createElement('iframe');
    iframe.id = `${DEFAULT_DOWNLOAD_IFRAME_ID}_${key}`;
    iframe.style.display = 'none';
    iframe.title = 'This is for download';
    document.body.appendChild(iframe);
    iframeRef.current = iframe;

    return () => {
      iframeRef.current && document.body.removeChild(iframeRef.current);
    };
  }, [key]);

  const trigger = useCallback(() => {
    if (iframeRef.current) {
      const iframe = iframeRef.current;
      iframe.src = downloadUrl;
    }
  }, [downloadUrl]);

  return { trigger };
};
