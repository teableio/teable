/* eslint-disable jsx-a11y/no-static-element-interactions,jsx-a11y/click-events-have-key-events */
import type { IAttachmentCellValue } from '@teable/core';
import { FieldKeyType } from '@teable/core';
import { ArrowDown, ArrowUp, Copy, Image, Maximize2, Trash2 } from '@teable/icons';
import type { IRecordInsertOrderRo } from '@teable/openapi';
import { createRecords, deleteRecord, duplicateRecord } from '@teable/openapi';
import { CellValue } from '@teable/sdk/components';
import { useFieldStaticGetter, useTableId, useViewId } from '@teable/sdk/hooks';
import type { Record } from '@teable/sdk/model';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@teable/ui-lib/shadcn';
import { Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { tableConfig } from '@/features/i18n/table.config';
import { useGallery } from '../hooks';
import { CARD_COVER_HEIGHT, CARD_STYLE } from '../utils';
import { CardCarousel } from './CardCarousel';

interface IKanbanCardProps {
  card: Record;
}

export const Card = (props: IKanbanCardProps) => {
  const { card } = props;
  const tableId = useTableId();
  const viewId = useViewId();
  const getFieldStatic = useFieldStaticGetter();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const {
    coverField,
    primaryField,
    displayFields,
    permission,
    isCoverFit,
    isFieldNameHidden,
    setExpandRecordId,
  } = useGallery();

  const { cardCreatable, cardDeletable } = permission;
  const coverFieldId = coverField?.id;
  const coverCellValue = card.getCellValue(coverFieldId as string) as
    | IAttachmentCellValue
    | undefined;

  const titleComponent = useMemo(() => {
    if (primaryField == null) return t('untitled');
    const value = card.getCellValue(primaryField.id);
    if (value == null) return t('untitled');
    return <CellValue field={primaryField} value={value} className="text-base" ellipsis />;
  }, [card, primaryField, t]);

  const onExpand = () => {
    setExpandRecordId(card.id);
  };

  const onDelete = () => {
    if (tableId == null) return;
    deleteRecord(tableId, card.id);
  };

  const onDuplicate = () => {
    if (tableId == null || viewId == null) return;
    duplicateRecord(tableId, card.id, { viewId, anchorId: card.id, position: 'after' });
  };

  const onInsert = async (position: IRecordInsertOrderRo['position']) => {
    if (tableId == null || viewId == null) return;
    const res = await createRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      records: [{ fields: {} }],
      order: {
        viewId,
        anchorId: card.id,
        position,
      },
    });
    const record = res.data.records[0];

    if (record != null) {
      setExpandRecordId(record.id);
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div
          className="size-full overflow-hidden rounded-md border border-input bg-background"
          onClick={onExpand}
        >
          {coverFieldId && (
            <Fragment>
              {coverCellValue?.length ? (
                <CardCarousel value={coverCellValue} isCoverFit={isCoverFit} />
              ) : (
                <div
                  style={{ height: CARD_COVER_HEIGHT }}
                  className="flex w-full items-center justify-center bg-muted"
                >
                  <Image className="size-20 text-gray-300 dark:text-gray-700" />
                </div>
              )}
            </Fragment>
          )}
          <div className="px-3 py-2">
            <div
              className="flex pb-2 text-base font-semibold"
              style={{ height: CARD_STYLE.titleHeight }}
            >
              {titleComponent}
            </div>
            {displayFields.map((field) => {
              const { id: fieldId, name, type, isLookup } = field;
              const { Icon } = getFieldStatic(type, isLookup);
              const cellValue = card.getCellValue(fieldId);

              if (cellValue == null) return null;

              return (
                <div key={fieldId} className="mb-2">
                  {!isFieldNameHidden && (
                    <div className="mb-1 flex items-center space-x-1 text-slate-500 dark:text-slate-400">
                      <Icon className="text-sm" />
                      <span className="text-xs">{name}</span>
                    </div>
                  )}
                  <CellValue field={field} value={cellValue} ellipsis />
                </div>
              );
            })}
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        {cardCreatable && (
          <>
            <ContextMenuItem onClick={() => onInsert('before')}>
              <ArrowUp className="mr-2 size-4" />
              {t('table:kanban.cardMenu.insertCardAbove')}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onInsert('after')}>
              <ArrowDown className="mr-2 size-4" />
              {t('table:kanban.cardMenu.insertCardBelow')}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onDuplicate}>
              <Copy className="mr-2 size-4" />
              {t('table:kanban.cardMenu.duplicateCard')}
            </ContextMenuItem>
          </>
        )}
        <ContextMenuItem onClick={onExpand}>
          <Maximize2 className="mr-2 size-4" />
          {t('table:kanban.cardMenu.expandCard')}
        </ContextMenuItem>
        {cardDeletable && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
              <Trash2 className="mr-2 size-4" />
              {t('table:kanban.cardMenu.deleteCard')}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
};
