import type { IAttachmentCellValue } from '@teable/core';
import { cn } from '@teable/ui-lib';
import type { IButtonClickStatusHook } from '../../hooks';
import { useFieldStaticGetter } from '../../hooks';
import type { Field, Record } from '../../model';
import { AiFieldGenerateButton } from './AiFieldGenerateButton';
import { CellEditorWrap } from './CellEditorWrap';

export const RecordEditorItem = (props: {
  field: Field;
  record: Record | undefined;
  vertical?: boolean;
  onChange?: (newValue: unknown, fieldId: string) => void;
  readonly?: boolean;
  buttonClickStatusHook?: IButtonClickStatusHook;
  onAttachmentDownload?: (attachments: IAttachmentCellValue) => void;
}) => {
  const {
    field,
    record,
    vertical,
    onChange,
    readonly,
    buttonClickStatusHook,
    onAttachmentDownload,
  } = props;
  const { type, isLookup } = field;
  const hasAiConfig = Boolean(field.aiConfig);
  const fieldStaticGetter = useFieldStaticGetter();
  const { Icon } = fieldStaticGetter(type, {
    isLookup,
    isConditionalLookup: field.isConditionalLookup,
    hasAiConfig,
  });

  const cellValue = record?.getCellValue(field.id);
  const onChangeInner = (value: unknown) => {
    if (cellValue === value) return;
    onChange?.(value, field.id);
  };

  return (
    <div className={vertical ? 'flex space-x-2' : 'space-y-2'}>
      <div className={cn('w-36 flex items-top space-x-1', vertical ? 'pt-1' : 'w-full')}>
        <div className="flex size-5 items-center">
          <Icon className="size-4" />
        </div>
        <div className={cn('text-sm truncate', vertical && 'break-words whitespace-normal')}>
          {field.name}
        </div>
        {field.notNull && (
          <span className="text-red-500" aria-label="required">
            *
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 items-start gap-1">
        <CellEditorWrap
          wrapClassName="min-w-0 flex-1 p-0.5"
          cellValue={cellValue}
          onChange={onChangeInner}
          field={field}
          recordId={record?.id}
          readonly={!record || readonly}
          record={record}
          buttonClickStatusHook={buttonClickStatusHook}
          onAttachmentDownload={onAttachmentDownload}
        />
        {hasAiConfig && field.tableId && record && !readonly && (
          <AiFieldGenerateButton tableId={field.tableId} fieldId={field.id} recordId={record.id} />
        )}
      </div>
    </div>
  );
};
