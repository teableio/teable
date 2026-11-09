import { useCallback } from 'react';

interface IDownloadProps {
  downloadUrl: string;
  key?: string;
}

const DEFAULT_DOWNLOAD_IFRAME_ID = 'teable_download_iframe_id';

/**
 * The hidden iframe a download loads into, one per key and shared by every caller with that key.
 * It is looked up when a download starts and left in place: a caller unmounting must not take it
 * away from the others still holding the same key (each row of a list, say).
 */
const getDownloadIframe = (key?: string) => {
  const id = `${DEFAULT_DOWNLOAD_IFRAME_ID}_${key}`;
  const existing = document.getElementById(id);
  if (existing instanceof HTMLIFrameElement) return existing;
  const iframe = document.createElement('iframe');
  iframe.id = id;
  iframe.style.display = 'none';
  iframe.title = 'This is for download';
  document.body.appendChild(iframe);
  return iframe;
};

export const useDownload = ({ downloadUrl, key }: IDownloadProps) => {
  const trigger = useCallback(() => {
    getDownloadIframe(key).src = downloadUrl;
  }, [downloadUrl, key]);

  return { trigger };
};
