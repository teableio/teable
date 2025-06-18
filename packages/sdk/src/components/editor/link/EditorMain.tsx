import type { ILinkCellValue, ILinkFieldOptions } from '@teable/core';
import { isMultiValueLink } from '@teable/core';
import { ArrowUpRight, Plus } from '@teable/icons';
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
import { RowCountProvider, LinkViewProvider } from '../../../context';
import { useTranslation } from '../../../context/app/i18n';
import { LinkFilterProvider } from '../../../context/query/LinkFilterProvider';
import { useBaseId, useLinkFilter, useRowCount, useSearch } from '../../../hooks';
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
  const rowCount = useRowCount() || 0;
  const baseId = useBaseId();

  useImperativeHandle(forwardRef, () => ({
    onReset,
  }));

  const { t } = useTranslation();

  const listRef = useRef<ILinkListRef>(null);
  const [values, setValues] = useState<ILinkCellValue[]>();

  const isMultiple = isMultiValueLink(options.relationship);
  const { foreignTableId, filterByViewId } = options;

  const {
    listType,
    setListType,
    selectedRecordIds,
    filterLinkCellCandidate,
    filterLinkCellSelected,
    setLinkCellCandidate,
    setLinkCellSelected,
  } = useLinkFilter();

  const recordQuery = useMemo((): IGetRecordsRo => {
    return {
      search: searchQuery,
      // for new record
      selectedRecordIds: recordId ? undefined : selectedRecordIds,
      filterLinkCellSelected,
      filterLinkCellCandidate,
    };
  }, [searchQuery, filterLinkCellCandidate, filterLinkCellSelected, selectedRecordIds, recordId]);

  useEffect(() => {
    if (!isEditing) return;
    listRef.current?.onForceUpdate();
    if (cellValue == null) return setValues(cellValue);
    setValues(Array.isArray(cellValue) ? cellValue : [cellValue]);
  }, [cellValue, isEditing]);

  const onViewShown = (type: LinkListType) => {
    if (type === listType) return;
    listRef.current?.onReset();
    setListType(type);
    if (type === LinkListType.Selected) {
      setLinkCellSelected([fieldId, recordId].filter(Boolean));
    } else {
      setLinkCellCandidate([fieldId, recordId].filter(Boolean));
    }
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

  const onNavigate = () => {
    if (!baseId) return;

    let path = `/base/${baseId}/${foreignTableId}`;

    if (filterByViewId) {
      path += `/${filterByViewId}`;
    }

    const url = new URL(path, window.location.origin);

    window.open(url.toString(), '_blank');
  };

  return (
    <>
      <div className="flex items-center space-x-0.5">
        <span className="text-lg">{t('editor.link.placeholder')}</span>
        <Button
          size="xs"
          variant="link"
          className="gap-0.5 text-[13px] text-slate-500 underline"
          onClick={onNavigate}
        >
          {t('editor.link.goToForeignTable')}
          <ArrowUpRight className="size-4" />
        </Button>
      </div>
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
        <CreateRecordModal>
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
  const { options, cellValue } = props;
  const { baseId: foreignBaseId } = options;
  const baseId = useBaseId();

  const selectedRecordIds = useMemo(() => {
    return Array.isArray(cellValue)
      ? cellValue.map((v) => v.id)
      : cellValue?.id
        ? [cellValue.id]
        : [];
  }, [cellValue]);

  return (
    <LinkViewProvider linkBaseId={foreignBaseId ?? baseId} linkFieldId={props.fieldId}>
      <LinkFilterProvider
        filterLinkCellCandidate={props.recordId ? [props.fieldId, props.recordId] : props.fieldId}
        selectedRecordIds={props.recordId ? undefined : selectedRecordIds}
      >
        <RowCountProvider>
          <LinkEditorInner ref={forwardRef} {...props} />
        </RowCountProvider>
      </LinkFilterProvider>
    </LinkViewProvider>
  );
};

export const LinkEditorMain = forwardRef(LinkEditorMainBase);
