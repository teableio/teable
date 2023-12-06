/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */
import type { IFileItemInner } from '../FilePreviewContext';

interface IImagePreviewProps extends IFileItemInner {}

export const ImagePreview = (props: IImagePreviewProps) => {
  const { src, name } = props;
  return (
    <img
      onClick={(e) => e.stopPropagation()}
      className="max-h-full max-w-full"
      src={src}
      alt={name}
    />
  );
};
