import { useQuery } from '@tanstack/react-query';
import { getCommentAttachmentUrl } from '@teable/openapi';
import { cn } from '@teable/ui-lib';
import { FilePreviewItem, FilePreviewProvider } from '@teable/ui-lib/src/base/file/preview/';
import { ReactQueryKeys } from '../../../../../config';
import { useTableId } from '../../../../../hooks';
import { useRecordId } from '../../../hooks';
import { useCommentStore } from '../../../useCommentStore';
import type { IBaseNodeProps } from '../type';

interface IBlockImageElementProps extends IBaseNodeProps {
  path: string;
  width?: number;
}
export const BlockImageElement = (props: IBlockImageElementProps) => {
  const { path, width, className } = props;
  const tableId = useTableId();
  const recordId = useRecordId();
  const { attachmentPresignedUrls, setAttachmentPresignedUrls } = useCommentStore();
  const { data: imageData } = useQuery({
    queryKey: ReactQueryKeys.commentAttachment(tableId!, recordId!, path),
    queryFn: () =>
      getCommentAttachmentUrl(tableId!, recordId!, path as string).then(({ data }) => data),
    enabled: !!(!attachmentPresignedUrls[path] && tableId && recordId),
  });
  if (imageData && !attachmentPresignedUrls[path as string]) {
    setAttachmentPresignedUrls(path, imageData);
  }

  return (
    <FilePreviewProvider>
      <div className={cn('flex', className)}>
        <FilePreviewItem
          src={imageData ?? attachmentPresignedUrls[path]}
          name="comment-img"
          mimetype="image/jpeg"
        >
          <img
            src={imageData ?? attachmentPresignedUrls[path]}
            width={width || 'auto'}
            alt="img"
            className="cursor-pointer rounded"
          />
        </FilePreviewItem>
      </div>
    </FilePreviewProvider>
  );
};
