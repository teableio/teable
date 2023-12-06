import type { IFileItemInner } from '../FilePreviewContext';

interface IImagePreviewProps extends IFileItemInner {}

export const ImagePreview = (props: IImagePreviewProps) => {
  const { src, name } = props;
  return <img className="max-h-full max-w-full" src={src} alt={name} />;
};
