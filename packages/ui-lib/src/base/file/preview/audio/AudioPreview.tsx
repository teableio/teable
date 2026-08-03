import type { IFileItemInner } from '../FilePreviewContext';

interface IAudioPreview extends IFileItemInner {}

export const AudioPreview = (props: IAudioPreview) => {
  const { src, name, downloadUrl } = props;
  return (
    <audio className="max-h-full max-w-full" controls src={src}>
      <track kind="captions" default />
      {downloadUrl && (
        <a href={downloadUrl} download={name}>
          Download audio
        </a>
      )}
    </audio>
  );
};
