import type { ILinkCellValue, ILinkFieldOptions } from '@teable/core';
import { isMultiValueLink } from '@teable/core';
import { Plus } from '@teable/icons';
import type { IGetRecordsRo } from '@teable/openapi';
import { Button, Dialog, DialogContent, DialogTrigger, useToast } from '@teable/ui-lib';
import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { LinkViewProvider, RowCountProvider } from '../../../context';
import { useTranslation } from '../../../context/app/i18n';
import { LinkFilterProvider } from '../../../context/query/LinkFilterProvider';
import { ExpandRecorder } from '../../expand-record';
import type { ILinkEditorMainRef } from './EditorMain';
import { LinkEditorMain } from './EditorMain';
import { LinkListType } from './interface';
import { LinkCard } from './LinkCard';
import type { ILinkListRef } from './LinkList';
import { LinkList } from './LinkList';

interface ILinkEditorProps {
  options: ILinkFieldOptions;
  fieldId: string;
  recordId?: string;
  readonly?: boolean;
  className?: string;
  cellValue?: ILinkCellValue | ILinkCellValue[];
  displayType?: LinkDisplayType;
  onChange?: (value: ILinkCellValue | ILinkCellValue[] | null) => void;
}

export enum LinkDisplayType {
  Grid = 'grid',
  List = 'list',
}

export const LinkEditor = (props: ILinkEditorProps) => {
  const {
    cellValue,
    options,
    onChange,
    readonly,
    className,
    displayType = LinkDisplayType.Grid,
  } = props;
  const { toast } = useToast();
  const listRef = useRef<ILinkListRef>(null);
  const linkEditorMainRef = useRef<ILinkEditorMainRef>(null);
  const [isEditing, setEditing] = useState<boolean>(false);
  const [values, setValues] = useState<ILinkCellValue[]>();
  const [expandRecordId, setExpandRecordId] = useState<string>();
  const { t } = useTranslation();

  const { foreignTableId, relationship } = options;
  const isMultiple = isMultiValueLink(relationship);
  const cvArray = useMemo(() => {
    return Array.isArray(cellValue) || !cellValue ? cellValue : [cellValue];
  }, [cellValue]);
  const recordIds = cvArray?.map((cv) => cv.id);
  const selectedRowCount = recordIds?.length ?? 0;

  const isEqualPrevValue = useMemo(() => {
    return JSON.stringify(values) === JSON.stringify(cellValue);
  }, [cellValue, values]);

  const selectedRecordIds = useMemo(() => {
    return Array.isArray(cellValue)
      ? cellValue.map((v) => v.id)
      : cellValue?.id
        ? [cellValue.id]
        : [];
  }, [cellValue]);

  const recordQuery = useMemo((): IGetRecordsRo => {
    return {
      selectedRecordIds,
    };
  }, [selectedRecordIds]);

  useEffect(() => {
    if (cellValue == null) return setValues(cellValue);
    setValues(Array.isArray(cellValue) ? cellValue : [cellValue]);
  }, [cellValue]);

  const updateExpandRecordId = (recordId?: string) => {
    if (recordId) {
      const existed = document.getElementById(`${foreignTableId}-${recordId}`);
      if (existed) {
        toast({ description: t('editor.link.alreadyOpen') });
        return;
      }
    }
    setExpandRecordId(recordId);
  };

  const onRecordExpand = (recordId: string) => {
    updateExpandRecordId(recordId);
  };

  const onRecordDelete = (recordId: string) => {
    onChange?.(
      isMultiple ? (cellValue as ILinkCellValue[])?.filter((cv) => cv.id !== recordId) : null
    );
  };

  const onRecordListChange = useCallback((value?: ILinkCellValue[]) => {
    setValues(value);
  }, []);

  const onOpenChange = (open: boolean) => {
    if (open) return setEditing?.(true);
    return linkEditorMainRef.current?.onReset();
  };

  const onConfirm = () => {
    if (values == null) return onChange?.(null);
    onChange?.(isMultiple ? values : values[0]);
  };

  return (
    <div className="space-y-3">
      {Boolean(selectedRowCount) &&
        (displayType === LinkDisplayType.Grid ? (
          <div className="relative h-40 w-full overflow-hidden rounded-md border">
            <LinkViewProvider linkFieldId={props.fieldId}>
              <LinkFilterProvider
                filterLinkCellCandidate={
                  props.recordId ? [props.fieldId, props.recordId] : props.fieldId
                }
                selectedRecordIds={props.recordId ? undefined : selectedRecordIds}
              >
                <RowCountProvider>
                  <LinkList
                    ref={listRef}
                    type={LinkListType.Selected}
                    rowCount={selectedRowCount}
                    readonly={readonly}
                    cellValue={cellValue}
                    isMultiple={isMultiple}
                    recordQuery={recordQuery}
                    onChange={onRecordListChange}
                    onExpand={onRecordExpand}
                  />
                </RowCountProvider>
              </LinkFilterProvider>
            </LinkViewProvider>
          </div>
        ) : (
          cvArray?.map(({ id, title }) => (
            <LinkCard
              key={id}
              title={title}
              readonly={readonly}
              onClick={() => onRecordExpand(id)}
              onDelete={() => onRecordDelete(id)}
            />
          ))
        ))}
      {!readonly && (
        <>
          <div className="flex justify-between">
            <Dialog open={isEditing} onOpenChange={onOpenChange}>
              <DialogTrigger asChild>
                <Button variant="outline" size={'sm'} className={className}>
                  <Plus />
                  {t('editor.link.selectRecord')}
                </Button>
              </DialogTrigger>
              <DialogContent className="flex h-[520px] max-w-4xl flex-col">
                <LinkEditorMain
                  {...props}
                  ref={linkEditorMainRef}
                  isEditing={isEditing}
                  setEditing={setEditing}
                />
              </DialogContent>
            </Dialog>
            {Boolean(selectedRowCount) &&
              !isEqualPrevValue &&
              displayType === LinkDisplayType.Grid && (
                <Button size={'sm'} onClick={onConfirm}>
                  {t('common.confirm')}
                </Button>
              )}
          </div>
          <ExpandRecorder
            tableId={foreignTableId}
            recordId={expandRecordId}
            recordIds={recordIds}
            onUpdateRecordIdCallback={updateExpandRecordId}
            onClose={() => updateExpandRecordId(undefined)}
          />
        </>
      )}
    </div>
  );
};
