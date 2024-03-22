import type { ILinkCellValue, ILinkFieldOptions } from '@teable/core';
import { isMultiValueLink } from '@teable/core';
import { Plus } from '@teable/icons';
import type { IGetRecordsRo } from '@teable/openapi';
import { Button, Input, Tabs, TabsList, TabsTrigger } from '@teable/ui-lib';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ForwardRefRenderFunction } from 'react';
import { AnchorProvider } from '../../../context';
import { useTranslation } from '../../../context/app/i18n';
import { useBase, useTable } from '../../../hooks';
import { Table } from '../../../model';
import { LinkListType } from './interface';
import type { ILinkListRef } from './LinkList';
import { LinkList } from './LinkList';

export interface ILinkEditorMainProps {
  fieldId: string;
  recordId?: string;
  options: ILinkFieldOptions;
  cellValue?: ILinkCellValue | ILinkCellValue[];
  isEditing?: boolean;
  setEditing?: (isEditing: boolean) => void;
  onChange?: (value?: ILinkCellValue | ILinkCellValue[]) => void;
  onExpandRecord?: (recordId: string) => void;
}

export interface ILinkEditorMainRef {
  onReset: () => void;
}

const LinkEditorInnerBase: ForwardRefRenderFunction<ILinkEditorMainRef, ILinkEditorMainProps> = (
  props,
  forwardRef
) => {
  const { recordId, fieldId, options, cellValue, isEditing, setEditing, onChange, onExpandRecord } =
    props;

  useImperativeHandle(forwardRef, () => ({
    onReset,
  }));

  const base = useBase();
  const table = useTable();
  const { t } = useTranslation();

  const listRef = useRef<ILinkListRef>(null);
  const [rowCount, setRowCount] = useState<number>(0);
  const [values, setValues] = useState<ILinkCellValue[]>();
  const [listType, setListType] = useState<LinkListType>(LinkListType.Unselected);

  const baseId = base.id;
  const tableId = table?.id;
  const isMultiple = isMultiValueLink(options.relationship);

  const recordQuery = useMemo((): IGetRecordsRo => {
    if (listType === LinkListType.Selected) {
      return {
        filterLinkCellSelected: recordId ? [fieldId, recordId] : fieldId,
      };
    }
    return {
      filterLinkCellCandidate: recordId ? [fieldId, recordId] : fieldId,
    };
  }, [fieldId, recordId, listType]);

  useEffect(() => {
    if (!isEditing) return;
    listRef.current?.onForceUpdate();
    if (cellValue == null) return setValues(cellValue);
    setValues(Array.isArray(cellValue) ? cellValue : [cellValue]);
  }, [cellValue, isEditing]);

  useEffect(() => {
    if (baseId == null || tableId == null) return;

    Table.getRowCount(tableId, recordQuery).then((res) => {
      setRowCount(res.data.rowCount);
    });
  }, [tableId, baseId, recordQuery]);

  const onViewShown = (type: LinkListType) => {
    if (type === listType) return;
    listRef.current?.onReset();
    setListType(type);
  };

  const onAppendRecord = async () => {
    if (baseId == null || table == null || tableId == null) return;

    const res = await table.createRecord({});
    const record = res.data.records[0];

    if (record != null) {
      onExpandRecord?.(record.id);
    }

    Table.getRowCount(tableId, recordQuery).then((res) => {
      const rowCount = res.data.rowCount;
      setRowCount(() => rowCount);
      listRef.current?.scrollToItem([0, rowCount - 1]);
    });
  };

  const onReset = () => {
    setValues(undefined);
    setEditing?.(false);
    setListType(LinkListType.Unselected);
    listRef.current?.onReset();
  };

  const onListChange = useCallback((value?: ILinkCellValue[]) => {
    setValues(value);
  }, []);

  const onConfirm = () => {
    onReset();
    if (values == null) return onChange?.(undefined);
    onChange?.(isMultiple ? values : values[0]);
  };

  return (
    <>
      <div className="text-lg">{t('editor.link.placeholder')}</div>
      <div className="flex justify-between">
        <Input className="flex-1" placeholder={t('editor.link.searchPlaceholder')} disabled />
        <div className="ml-4">
          <Tabs defaultValue="unselected" orientation="horizontal" className="flex gap-4">
            <TabsList className="">
              <TabsTrigger
                className="px-4"
                value="unselected"
                onClick={() => onViewShown(LinkListType.Unselected)}
              >
                {t('editor.link.unselected')}
              </TabsTrigger>
              <TabsTrigger
                className="px-4"
                value="selected"
                onClick={() => onViewShown(LinkListType.Selected)}
              >
                {t('editor.link.selected')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>
      <div className="relative w-full flex-1 overflow-hidden rounded-md border">
        <LinkList
          ref={listRef}
          type={listType}
          rowCount={rowCount}
          cellValue={cellValue}
          isMultiple={isMultiple}
          recordQuery={recordQuery}
          onChange={onListChange}
        />
      </div>
      <div className="flex justify-between">
        <Button variant="ghost" onClick={onAppendRecord}>
          <Plus className="size-4" />
          {t('editor.link.create')}
        </Button>
        <div>
          <Button variant="outline" onClick={onReset}>
            {t('common.cancel')}
          </Button>
          <Button className="ml-4" onClick={onConfirm}>
            {t('common.confirm')}
          </Button>
        </div>
      </div>
    </>
  );
};

const LinkEditorInner = forwardRef(LinkEditorInnerBase);

const LinkEditorMainBase: ForwardRefRenderFunction<ILinkEditorMainRef, ILinkEditorMainProps> = (
  props,
  forwardRef
) => {
  const { options } = props;
  const tableId = options.foreignTableId;

  return (
    <AnchorProvider tableId={tableId}>
      <LinkEditorInner ref={forwardRef} {...props} />
    </AnchorProvider>
  );
};

export const LinkEditorMain = forwardRef(LinkEditorMainBase);
