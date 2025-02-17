import { cn, FilePreviewItem, FilePreviewProvider } from '@teable/ui-lib';
import type { IBaseNodeProps } from '../type';

interface IBlockImageElementProps extends IBaseNodeProps {
  path: string;
  url?: string;
  width?: number;
}
export const BlockImageElement = (props: IBlockImageElementProps) => {
  const { width, className, url } = props;

  if (!url) {
    return null;
  }

  return (
    <FilePreviewProvider>
      <div className={cn('flex', className)}>
        <FilePreviewItem src={url} name="comment-img" mimetype="image/jpeg">
          <img src={url} width={width || 'auto'} alt="img" className="cursor-pointer rounded" />
        </FilePreviewItem>
      </div>
    </FilePreviewProvider>
  );
};
