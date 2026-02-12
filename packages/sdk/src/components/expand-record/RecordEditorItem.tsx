import type { IAttachmentCellValue } from '@teable/core';
import { cn } from '@teable/ui-lib';
import { AlertCircle } from 'lucide-react';
import { useContext } from 'react';
import { TaskStatusCollectionContext } from '../../context';
import type { IButtonClickStatusHook } from '../../hooks';
import { useFieldStaticGetter } from '../../hooks';
import type { Field, Record } from '../../model';
import { AiFieldGenerateButton } from './AiFieldGenerateButton';
import { CellEditorWrap } from './CellEditorWrap';
import { TooltipWrap } from './TooltipWrap';

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
  const taskStatusCollection = useContext(TaskStatusCollectionContext);
  const isInTaskQueue =
    taskStatusCollection?.cells?.some((c) => c.recordId === record?.id && c.fieldId === field.id) ??
    false;
  const cellValue = record?.getCellValue(field.id);
  const onChangeInner = (value: unknown) => {
    if (cellValue === value) return;
    onChange?.(value, field.id);
  };

  return (
    <div className={cn(vertical ? 'flex space-x-2' : 'space-y-2', 'relative group')}>
      <div className={cn('w-36 flex items-top space-x-1 ', vertical ? 'pt-1' : 'w-full')}>
        <div className="flex size-5 items-center">
          <Icon className="size-4" />
        </div>
        <div className="flex min-w-0 items-start justify-between gap-1 text-sm">
          <span className={cn('min-w-0 truncate', vertical && 'break-words whitespace-normal')}>
            {field.name}
          </span>
          {field.description && (
            <TooltipWrap description={field.description}>
              <AlertCircle className="mt-0.5 size-3.5 shrink-0 cursor-pointer text-muted-foreground" />
            </TooltipWrap>
          )}
        </div>
        {field.notNull && (
          <span className="text-red-500" aria-label="required">
            *
          </span>
        )}
      </div>
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

      <div
        className={cn(
          'absolute -right-8 top-1 opacity-0 transition-opacity group-hover:opacity-100',
          isInTaskQueue && 'opacity-100'
        )}
      >
        {hasAiConfig && field.tableId && record && !readonly && (
          <AiFieldGenerateButton
            tableId={field.tableId}
            fieldId={field.id}
            recordId={record.id}
            isInTaskQueue={isInTaskQueue}
          />
        )}
      </div>
    </div>
  );
};
