import type { IAttachmentCellValue } from '@teable/core';
import { useTheme } from '@teable/next-themes';
import { FilePreviewItem, FilePreviewProvider, cn } from '@teable/ui-lib';
import { getFileCover, isSystemFileIcon } from '../../editor/attachment';
import { useAttachmentPreviewI18Map } from '../../hooks';
import type { ICellValue } from '../type';

interface ICellAttachment extends ICellValue<IAttachmentCellValue> {
  itemClassName?: string;
  formatImageUrl?: (url: string) => string;
}

export const CellAttachment = (props: ICellAttachment) => {
  const { value, className, style, itemClassName } = props;
  const i18nMap = useAttachmentPreviewI18Map();
  const { resolvedTheme } = useTheme();
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
                  'border-none': isSystemFileIcon(attachment.mimetype),
                },
                itemClassName
              )}
              src={presignedUrl || ''}
              name={name}
              mimetype={mimetype}
              size={size}
            >
              <img
                className="size-full object-contain"
                src={
                  lgThumbnailUrl ??
                  getFileCover(mimetype, presignedUrl, resolvedTheme as 'light' | 'dark')
                }
                alt={name}
              />
            </FilePreviewItem>
          );
        })}
      </div>
    </FilePreviewProvider>
  );
};
