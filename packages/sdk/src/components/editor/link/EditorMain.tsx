import type { ILinkCellValue, ILinkFieldOptions } from '@teable/core';
import { isMultiValueLink } from '@teable/core';
import { Plus } from '@teable/icons';
import type { IGetRecordsRo } from '@teable/openapi';
import { Button, Tabs, TabsList, TabsTrigger } from '@teable/ui-lib';
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
import { StandaloneViewProvider } from '../../../context';
import { useTranslation } from '../../../context/app/i18n';
import { useBaseId, useSearch, useTableId } from '../../../hooks';
import { Table } from '../../../model';
import { CreateRecordModal } from '../../create-record';
import { SearchInput } from '../../search';
import { LinkListType } from './interface';
import type { ILinkListRef } from './LinkList';
import { LinkList } from './LinkList';

export interface ILinkEditorMainProps {
  fieldId: string;
  recordId?: string;
  options: ILinkFieldOptions;
  container?: HTMLElement;
  cellValue?: ILinkCellValue | ILinkCellValue[];
  isEditing?: boolean;
  setEditing?: (isEditing: boolean) => void;
  onChange?: (value: ILinkCellValue | ILinkCellValue[] | null) => void;
}

export interface ILinkEditorMainRef {
  onReset: () => void;
}

const LinkEditorInnerBase: ForwardRefRenderFunction<ILinkEditorMainRef, ILinkEditorMainProps> = (
  props,
  forwardRef
) => {
  const { recordId, fieldId, options, cellValue, isEditing, setEditing, onChange } = props;

  const { searchQuery } = useSearch();

  useImperativeHandle(forwardRef, () => ({
    onReset,
  }));

  const baseId = useBaseId();
  const tableId = useTableId();
  const { t } = useTranslation();

  const listRef = useRef<ILinkListRef>(null);
  const [rowCount, setRowCount] = useState<number>(0);
  const [values, setValues] = useState<ILinkCellValue[]>();
  const [listType, setListType] = useState<LinkListType>(LinkListType.Unselected);

  const isMultiple = isMultiValueLink(options.relationship);

  const recordQuery = useMemo((): IGetRecordsRo => {
    if (listType === LinkListType.Selected) {
      return {
        search: searchQuery,
        filterLinkCellSelected: recordId ? [fieldId, recordId] : fieldId,
      };
    }
    return {
      search: searchQuery,
      filterLinkCellCandidate: recordId ? [fieldId, recordId] : fieldId,
    };
  }, [listType, searchQuery, recordId, fieldId]);

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

  const onCreateRecordCallback = async () => {
    if (tableId == null) return;

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
    if (values == null) return onChange?.(null);
    onChange?.(isMultiple ? values : values[0]);
  };

  return (
    <>
      <div className="text-lg">{t('editor.link.placeholder')}</div>
      <div className="flex items-center justify-between">
        <SearchInput container={props.container} />
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
        <CreateRecordModal callback={onCreateRecordCallback}>
          <Button variant="ghost">
            <Plus className="size-4" />
            {t('editor.link.create')}
          </Button>
        </CreateRecordModal>
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
  const selfBaseId = useBaseId();
  const baseId = options.baseId || selfBaseId;

  return (
    <StandaloneViewProvider baseId={baseId} tableId={tableId}>
      <LinkEditorInner ref={forwardRef} {...props} />
    </StandaloneViewProvider>
  );
};

export const LinkEditorMain = forwardRef(LinkEditorMainBase);
