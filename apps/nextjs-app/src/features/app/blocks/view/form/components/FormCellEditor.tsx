import type { IAttachmentCellValue, ILinkCellValue, ILinkFieldOptions } from '@teable/core';
import { FieldType } from '@teable/core';
import { AttachmentManager, CellEditor, LinkDisplayType, LinkEditor } from '@teable/sdk/components';
import { UploadAttachment } from '@teable/sdk/components/editor/attachment/upload-attachment/UploadAttachment';
import type { Field, LinkField } from '@teable/sdk/model';
import { cn } from '@teable/ui-lib/shadcn';
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
  const { id, type, options } = field;

  if (shareId && type === FieldType.Link) {
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

  if (shareId && type === FieldType.Attachment) {
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

  if (type === FieldType.Link) {
    return (
      <LinkEditor
        className={className}
        cellValue={cellValue as ILinkCellValue | ILinkCellValue[]}
        options={options as ILinkFieldOptions}
        onChange={onChange}
        fieldId={id}
        displayType={LinkDisplayType.List}
      />
    );
  }

  return (
    <CellEditor cellValue={cellValue} field={field} onChange={onChange} className={className} />
  );
};
