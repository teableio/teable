import { X } from '@teable/icons';
import type { ITemplateCoverVo } from '@teable/openapi';
import { useAttachmentPreviewI18Map } from '@teable/sdk/components/hooks';
import { cn, FilePreviewItem, FilePreviewProvider } from '@teable/ui-lib';

interface ITemplatePreviewProps {
  cover: ITemplateCoverVo;
  onClose: () => void;
}
export const TemplateCoverPreview = (props: ITemplatePreviewProps) => {
  const { cover, onClose } = props;
  const i18nMap = useAttachmentPreviewI18Map();
  const { presignedUrl, mimetype, size, name } = cover;

  return (
    <FilePreviewProvider i18nMap={i18nMap}>
      <div className="group relative size-full rounded-sm text-sm">
        {presignedUrl && (
          <FilePreviewItem
            className={cn(
              'shrink-0 size-full rounded border-slate-200 overflow-hidden cursor-pointer border'
            )}
            src={presignedUrl}
            name={name}
            mimetype={mimetype!}
            size={size}
          >
            <img className="size-full object-contain" src={presignedUrl} alt={name} />
          </FilePreviewItem>
        )}
        <X
          className="absolute -right-2 -top-2 hidden size-4 cursor-pointer rounded-full bg-secondary p-0.5 group-hover:block hover:opacity-70"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        />
      </div>
    </FilePreviewProvider>
  );
};
