import { useEffect, useRef } from 'react';
import type { IFileItemInner } from '../FilePreviewContext';

interface IVideoPreview extends IFileItemInner {}

export const VideoPreview = (props: IVideoPreview) => {
  const { src, name, downloadUrl } = props;
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.load();
    }
  }, [src]);

  return (
    <video ref={videoRef} className="max-h-full max-w-full" controls>
      <track kind="captions" default />
      <source src={src} type="video/webm" />
      <source src={src} type="video/mp4" />
      {downloadUrl && (
        <a href={downloadUrl} download={name}>
          MP4
        </a>
      )}
      {downloadUrl && (
        <a href={downloadUrl} download={name}>
          WEBM
        </a>
      )}
    </video>
  );
};
