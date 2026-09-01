import type { IAttachmentCellValue } from '@teable/core';
import { Info } from '@teable/icons';
import { cn } from '@teable/ui-lib';
import { useContext } from 'react';
import { TaskStatusCollectionContext } from '../../context';
import type { IButtonClickStatusHook } from '../../hooks';
import { useFieldStaticGetter } from '../../hooks';
import { useContentDir } from '../../hooks/use-content-dir';
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
  const contentDir = useContentDir();
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
  const compact = !vertical;
  const showAiGenerateButton = hasAiConfig && Boolean(field.tableId && record && !readonly);
  const aiGenerateButton = showAiGenerateButton && field.tableId && record && (
    <AiFieldGenerateButton
      tableId={field.tableId}
      fieldId={field.id}
      recordId={record.id}
      isInTaskQueue={isInTaskQueue}
    />
  );
  const onChangeInner = (value: unknown) => {
    if (cellValue === value) return;
    onChange?.(value, field.id);
  };

  return (
    <div
      className={cn(
        vertical ? 'flex space-x-4 rtl:space-x-reverse' : 'space-y-2',
        'relative group/field-row'
      )}
    >
      <div
        className={cn(
          'flex w-36 items-start gap-1',
          vertical ? 'pt-1' : 'relative w-full items-center',
          compact && aiGenerateButton && 'pe-8'
        )}
      >
        <div className="me-1 flex size-4 items-center">
          <Icon className="size-4" />
        </div>
        <div
          className={cn(
            'flex min-w-0 flex-1 gap-1 text-sm',
            vertical ? 'items-start' : 'items-center'
          )}
        >
          <span className="flex min-w-0">
            <span
              dir={contentDir}
              className={cn('min-w-0 truncate', vertical && 'break-words whitespace-normal')}
            >
              {field.name}
            </span>
            {field.notNull && (
              <span className="ms-0.5 shrink-0 text-red-500" aria-label="required">
                *
              </span>
            )}
          </span>
          {field.description && (
            <TooltipWrap description={field.description}>
              <span
                className={cn(
                  'ms-0.5 inline-flex shrink-0 cursor-pointer text-muted-foreground',
                  vertical && 'mt-[3px]'
                )}
              >
                <Info className="size-4" />
              </span>
            </TooltipWrap>
          )}
        </div>
        {compact && aiGenerateButton && (
          <div className="absolute end-0 top-1/2 -translate-y-1/2">{aiGenerateButton}</div>
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

      {!compact && aiGenerateButton && (
        <div
          className={cn(
            'absolute -end-8 top-1 opacity-0 transition-opacity group-hover/field-row:opacity-100',
            isInTaskQueue && 'opacity-100'
          )}
        >
          {aiGenerateButton}
        </div>
      )}
    </div>
  );
};
