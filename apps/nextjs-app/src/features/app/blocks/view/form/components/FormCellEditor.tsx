import type { ILinkCellValue } from '@teable-group/core';
import { FieldType } from '@teable-group/core';
import { CellEditor } from '@teable-group/sdk/components';
import type { Field, LinkField } from '@teable-group/sdk/model';
import { useRouter } from 'next/router';
import { ShareFormLinkEditor } from './share-link-editor/FormLinkEditor';

interface IFormCellEditor {
  className?: string;
  cellValue?: unknown;
  field: Field;
  onChange?: (cellValue?: unknown) => void;
}

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
  return (
    <CellEditor cellValue={cellValue} field={field} onChange={onChange} className={className} />
  );
};
