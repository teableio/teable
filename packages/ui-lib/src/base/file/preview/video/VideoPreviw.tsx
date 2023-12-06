import type { IFileItemInner } from '../FilePreviewContext';

interface IVideoPreview extends IFileItemInner {}

export const VideoPreview = (props: IVideoPreview) => {
  const { src, name, downloadUrl } = props;
  return (
    <video className="max-h-full max-w-full" controls>
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
