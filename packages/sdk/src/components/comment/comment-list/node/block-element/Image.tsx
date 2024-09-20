import { useQuery } from '@tanstack/react-query';
import { getCommentAttachmentUrl } from '@teable/openapi';
import { cn } from '@teable/ui-lib';
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
    <div className={cn('flex', className)}>
      <img
        src={imageData ?? attachmentPresignedUrls[path]}
        width={width || 'auto'}
        alt="img"
        className="cursor-pointer rounded"
      />
    </div>
  );
};
