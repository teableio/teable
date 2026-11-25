import type {
  IAttachmentCellValue,
  ILinkCellValue,
  ILinkFieldOptions,
  IUserCellValue,
} from '@teable/core';
import { FieldType } from '@teable/core';
import { AttachmentManager, CellEditor, LinkDisplayType, LinkEditor } from '@teable/sdk/components';
import { UploadAttachment } from '@teable/sdk/components/editor/attachment/upload-attachment/UploadAttachment';
import { ShareViewContext } from '@teable/sdk/context';
import type { Field, LinkField, UserField } from '@teable/sdk/model';
import { cn } from '@teable/ui-lib/shadcn';
import { useContext } from 'react';
import { ShareFormLinkEditor } from './share-link-editor/FormLinkEditor';
import { ShareUserEditor } from './ShareUserEditor';

interface IFormCellEditor {
  className?: string;
  cellValue?: unknown;
  field: Field;
  onChange?: (cellValue?: unknown) => void;
}

const attachmentManager = new AttachmentManager(2);

export const FormCellEditor = (props: IFormCellEditor) => {
  const { cellValue, field, className, onChange } = props;
  // Only a shared view serves its form through the share's own routes. A project share page
  // carries a share id in its URL too, but it is the ordinary table page.
  const { shareId } = useContext(ShareViewContext) ?? {};
  const { id, type, options } = field;

  if (shareId) {
    switch (type) {
      case FieldType.Link:
        return (
          <ShareFormLinkEditor
            shareId={shareId}
            cellValue={cellValue as ILinkCellValue | ILinkCellValue[] | undefined}
            field={field as LinkField}
            onChange={onChange}
            className={className}
          />
        );
      case FieldType.Attachment:
        attachmentManager.shareId = shareId;
        return (
          <UploadAttachment
            mode="local"
            className={cn('max-h-64', className)}
            attachments={(cellValue ?? []) as IAttachmentCellValue}
            onChange={onChange}
            attachmentManager={attachmentManager}
          />
        );
      case FieldType.User:
        return (
          <ShareUserEditor
            shareId={shareId}
            cellValue={cellValue as IUserCellValue | IUserCellValue[]}
            field={field as UserField}
            onChange={onChange}
            className={className}
          />
        );
      default:
        return (
          <CellEditor
            cellValue={cellValue}
            field={field}
            onChange={onChange}
            className={className}
          />
        );
    }
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
