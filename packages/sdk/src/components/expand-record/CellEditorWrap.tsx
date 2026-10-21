import { useQuery } from '@tanstack/react-query';
import type { ILinkCellValue, ILinkFieldOptions } from '@teable/core';
import { FieldType, isCrossBaseField } from '@teable/core';
import { getTableList } from '@teable/openapi';
import { cn } from '@teable/ui-lib';
import { ReactQueryKeys } from '../../config';
import { useBaseId, useTables } from '../../hooks';
import { CellEditor } from '../cell-value-editor';
import type { ICellValueEditor } from '../cell-value-editor/type';
import { LinkDisplayType, LinkEditor } from '../editor';

export const CellEditorWrap = (props: ICellValueEditor) => {
  const { field } = props;
  const baseId = useBaseId();
  const tables = useTables();
  if (field.type === FieldType.Link && !field.isComputed) {
    if (isCrossBaseField(field, baseId)) {
      return <CrossBaseLinkFieldEditor {...props} />;
    }
    const { foreignTableId } = field.options as ILinkFieldOptions;
    // A restricted project lists only its authority-matrix tables, and a list belongs to the
    // base that mounted it. A list that carries this field's own table therefore answers for
    // the linked table, and a field without its own table id (fields built for the link
    // picker) is read as a field of the mounted base. Without such a list the record detail
    // cannot judge the linked table, so it falls back to the rule it used before the child
    // table was pinned away (`readonly ? list : grid`): only an editable cell shows it.
    const fieldTableListed = !field.tableId || tables.some((table) => table.id === field.tableId);
    const linkedTableListed = tables.some((table) => table.id === foreignTableId);
    const readable = fieldTableListed ? linkedTableListed : !props.readonly;
    return <LinkFieldEditor {...props} readable={readable} />;
  }
  return <CellEditor {...props} hideExpand />;
};

const CrossBaseLinkFieldEditor = (props: ICellValueEditor) => {
  const options = props.field.options as ILinkFieldOptions;
  const foreignBaseId = options.baseId ?? '';
  const { data, isSuccess } = useQuery({
    queryKey: ReactQueryKeys.tableList(foreignBaseId),
    queryFn: () => getTableList(foreignBaseId).then((response) => response.data),
    enabled: foreignBaseId.length > 0,
    meta: { preventGlobalError: true },
  });
  // While the foreign project's tables are unknown the cell keeps the compact tags, so the
  // linked records stay visible instead of the field rendering empty.
  const readable = isSuccess && data.some((table) => table.id === options.foreignTableId);
  return <LinkFieldEditor {...props} readable={readable} />;
};

const LinkFieldEditor = ({ readable, ...props }: ICellValueEditor & { readable: boolean }) => {
  const { field, wrapClassName, className, cellValue, onChange, readonly, recordId } = props;
  return (
    <div className={cn(wrapClassName, 'max-h-96 overflow-auto')}>
      <LinkEditor
        className={className}
        cellValue={cellValue as ILinkCellValue | ILinkCellValue[]}
        options={field.options as ILinkFieldOptions}
        onChange={onChange}
        readonly={readonly}
        fieldId={field.id}
        recordId={recordId}
        displayType={readable ? LinkDisplayType.Grid : LinkDisplayType.Tags}
        isSelectedRowBgVisible={false}
      />
    </div>
  );
};
