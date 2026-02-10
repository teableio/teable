import { useQueryClient } from '@tanstack/react-query';
import type { ILinkCellValue, ILinkFieldOptions } from '@teable/core';
import { isMultiValueLink, RelationshipRevert } from '@teable/core';
import { ArrowUpRight, Plus } from '@teable/icons';
import type { IGetRecordsRo } from '@teable/openapi';
import { getRecordIndex } from '@teable/openapi';
import { Button, Tabs, TabsList, TabsTrigger } from '@teable/ui-lib';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import type { ForwardRefRenderFunction } from 'react';
import { RowCountProvider, LinkViewProvider } from '../../../context';
import { useTranslation } from '../../../context/app/i18n';
import { LinkFilterProvider } from '../../../context/query/LinkFilterProvider';
import {
  useBaseId,
  useLinkFilter,
  useRowCount,
  useSearch,
  useTableId,
  useTables,
  useViewId,
} from '../../../hooks';
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
  onExpand?: (recordId: string) => void;
  currentRecordTitle?: string;
}

export interface ILinkEditorMainRef {
  onReset: () => void;
}

const LinkEditorInnerBase: ForwardRefRenderFunction<ILinkEditorMainRef, ILinkEditorMainProps> = (
  props,
  forwardRef
) => {
  const {
    recordId,
    fieldId,
    options,
    cellValue,
    isEditing,
    setEditing,
    onChange,
    onExpand,
    currentRecordTitle,
  } = props;

  const { searchQuery } = useSearch();
  const rowCount = useRowCount() || 0;
  const baseId = useBaseId();
  const tableId = useTableId();
  const viewId = useViewId();
  const queryClient = useQueryClient();

  useImperativeHandle(forwardRef, () => ({
    onReset,
  }));

  const { t } = useTranslation();

  const listRef = useRef<ILinkListRef>(null);

  const isMultiple = isMultiValueLink(options.relationship);
  const { foreignTableId, filterByViewId } = options;

  const tables = useTables();
  const foreignTableName = useMemo(() => {
    return tables.find((t) => t.id === foreignTableId)?.name;
  }, [tables, foreignTableId]);

  const {
    listType,
    selectedRecordIds,
    filterLinkCellSelected,
    filterLinkCellCandidate,
    setListType,
    setLinkCellSelected,
  } = useLinkFilter();

  const recordQuery = useMemo((): IGetRecordsRo => {
    const isSelectedList = listType === LinkListType.Selected;
    return {
      search: searchQuery,
      // for new record, only limit in selected list
      selectedRecordIds: !recordId && isSelectedList ? selectedRecordIds : undefined,
      filterLinkCellSelected: isSelectedList ? filterLinkCellSelected : undefined,
      filterLinkCellCandidate: listType === LinkListType.All ? filterLinkCellCandidate : undefined,
    };
  }, [
    searchQuery,
    filterLinkCellSelected,
    filterLinkCellCandidate,
    selectedRecordIds,
    recordId,
    listType,
  ]);

  useEffect(() => {
    if (!isEditing) return;
    if (tableId) {
      queryClient.removeQueries({ queryKey: ['link-editor-records', tableId] });
      queryClient.invalidateQueries({ queryKey: ['row-count', tableId] });
    }
    listRef.current?.onReset();
    listRef.current?.onForceUpdate();
  }, [isEditing, queryClient, tableId]);

  const onViewShown = (type: LinkListType) => {
    if (type === listType) return;
    if (tableId) {
      queryClient.removeQueries({ queryKey: ['link-editor-records', tableId] });
      queryClient.invalidateQueries({ queryKey: ['row-count', tableId] });
    }
    listRef.current?.onReset();
    setListType(type);
    if (type === LinkListType.Selected) {
      setLinkCellSelected([fieldId, recordId].filter(Boolean));
    }
  };

  const onReset = () => {
    setEditing?.(false);
    setListType(LinkListType.All);
    listRef.current?.onReset();
  };

  const onListChange = useCallback(
    (value?: ILinkCellValue[]) => {
      if (!value || value.length === 0) {
        onChange?.(null);
        return;
      }
      onChange?.(isMultiple ? value : value[0]);
    },
    [isMultiple, onChange]
  );

  const onRecordCreated = useCallback(
    (newRecordId: string) => {
      // 1. Immediately select the new record
      const newLink: ILinkCellValue = { id: newRecordId };
      if (isMultiple) {
        const existing = Array.isArray(cellValue) ? cellValue : cellValue ? [cellValue] : [];
        onChange?.([...existing, newLink]);
      } else {
        onChange?.(newLink);
      }

      // 2. Invalidate queries so the list reloads with the new record
      queryClient.invalidateQueries({ queryKey: ['row-count', tableId] });
      queryClient.invalidateQueries({ queryKey: ['link-editor-records', tableId] });

      // 3. Get the record's position and scroll to it
      if (tableId) {
        getRecordIndex(tableId, {
          recordId: newRecordId,
          viewId,
          ...recordQuery,
        })
          .then(({ data }) => {
            if (data != null) {
              listRef.current?.scrollToItem([0, data.index]);
            }
          })
          .catch(() => {
            // Fallback: scroll to end if index lookup fails
            listRef.current?.scrollToItem([0, rowCount]);
          });
      }
    },
    [isMultiple, cellValue, onChange, queryClient, tableId, viewId, recordQuery, rowCount]
  );

  const initialFields = useMemo(() => {
    if (!recordId || !options.symmetricFieldId) {
      return undefined;
    }
    const normalizedTitle = currentRecordTitle?.trim() || undefined;
    const linkValue: ILinkCellValue = {
      id: recordId,
      title: normalizedTitle,
    };
    const foreignRelationship = RelationshipRevert[options.relationship];
    const isForeignMultiple = isMultiValueLink(foreignRelationship);
    return {
      [options.symmetricFieldId]: isForeignMultiple ? [linkValue] : linkValue,
    };
  }, [currentRecordTitle, options.relationship, options.symmetricFieldId, recordId]);

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
      <div className="flex items-center space-x-4">
        <span className="text-base">{t('editor.link.placeholder')}</span>
        <div className="flex items-center space-x-1">
          <span className="text-xs">{t('editor.link.linkedTo')}</span>
          <Button
            size="xs"
            variant="secondary"
            className="h-auto gap-0.5 px-1 py-0.5 text-xs font-normal text-muted-foreground"
            onClick={onNavigate}
          >
            {foreignTableName}
            <ArrowUpRight className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <SearchInput container={props.container} globalOnly />
        <div className="ml-4">
          <Tabs
            value={listType === LinkListType.Selected ? 'selected' : 'all'}
            orientation="horizontal"
            className="flex gap-4"
          >
            <TabsList className="">
              <TabsTrigger
                className="px-4"
                value="all"
                onClick={() => onViewShown(LinkListType.All)}
              >
                {t('editor.link.all')}
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
          onExpand={onExpand}
        />
      </div>
      <div className="flex justify-between">
        <CreateRecordModal callback={onRecordCreated} initialFields={initialFields}>
          <Button variant="outline">
            <Plus className="size-4" />
            {t('editor.link.create')}
          </Button>
        </CreateRecordModal>
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
