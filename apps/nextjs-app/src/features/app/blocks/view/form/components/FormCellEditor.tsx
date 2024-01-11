import type { IAttachmentCellValue, ILinkCellValue } from '@teable-group/core';
import { FieldType } from '@teable-group/core';
import { AttachmentManager, CellEditor } from '@teable-group/sdk/components';
import { UploadAttachment } from '@teable-group/sdk/components/editor/attachment/upload-attachment/UploadAttachment';
import type { Field, LinkField } from '@teable-group/sdk/model';
import { cn } from '@teable-group/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { ShareFormLinkEditor } from './share-link-editor/FormLinkEditor';

interface IFormCellEditor {
  className?: string;
  cellValue?: unknown;
  field: Field;
  onChange?: (cellValue?: unknown) => void;
}

const attachmentManager = new AttachmentManager(2);

export const FormCellEditor = (props: IFormCellEditor) => {
  const { cellValue, field, className, onChange } = props;
  const router = useRouter();
  const shareId = router.query.shareId;
  if (shareId && field.type === FieldType.Link) {
    return (
      <ShareFormLinkEditor
        shareId={shareId as string}
        cellValue={cellValue as ILinkCellValue | ILinkCellValue[] | undefined}
        field={field as LinkField}
        onChange={onChange}
        className={className}
      />
    );
  }
  if (shareId && field.type === FieldType.Attachment) {
    attachmentManager.shareId = shareId as string;
    return (
      <UploadAttachment
        className={cn('h-64', className)}
        attachments={(cellValue ?? []) as IAttachmentCellValue}
        onChange={onChange}
        attachmentManager={attachmentManager}
      />
    );
  }
  return (
    <CellEditor cellValue={cellValue} field={field} onChange={onChange} className={className} />
  );
};
