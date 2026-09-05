import type { IAttachmentCellValue } from '@teable/core';
import { FilePreviewItem, FilePreviewProvider, cn, isImage } from '@teable/ui-lib';
import { isSystemFileIcon } from '../../editor/attachment';
import { useAttachmentPreviewI18Map } from '../../hooks';
import { FileCover } from '../../upload/FileCover';
import type { ICellValue } from '../type';

interface ICellAttachment extends ICellValue<IAttachmentCellValue> {
  itemClassName?: string;
  formatImageUrl?: (url: string) => string;
}

export const CellAttachment = (props: ICellAttachment) => {
  const { value, className, style, itemClassName } = props;
  const i18nMap = useAttachmentPreviewI18Map();
  return (
    <FilePreviewProvider i18nMap={i18nMap}>
      <div className={cn('flex gap-1 flex-wrap', className)} style={style}>
        {value?.map((attachment) => {
          const { id, name, mimetype, size, presignedUrl, lgThumbnailUrl } = attachment;

          return (
            <FilePreviewItem
              key={id}
              className={cn(
                'shrink-0 size-7 border rounded border-slate-200 overflow-hidden cursor-pointer',
                {
                  'border-none':
                    isSystemFileIcon(attachment.mimetype) && !attachment.lgThumbnailUrl,
                },
                itemClassName
              )}
              src={presignedUrl || ''}
              thumb={lgThumbnailUrl}
              name={name}
              mimetype={mimetype}
              size={size}
            >
              <FileCover
                className="size-full object-contain"
                iconClassName="size-full"
                mimetype={mimetype}
                url={lgThumbnailUrl ?? (isImage(mimetype) ? presignedUrl : undefined)}
                name={name}
              />
            </FilePreviewItem>
          );
        })}
      </div>
    </FilePreviewProvider>
  );
};
