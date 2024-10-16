/* eslint-disable jsx-a11y/no-static-element-interactions,jsx-a11y/click-events-have-key-events */
import type { DraggableProvided } from '@hello-pangea/dnd';
import { FieldKeyType, type IAttachmentCellValue } from '@teable/core';
import { ArrowDown, ArrowUp, Maximize2, Trash } from '@teable/icons';
import type { IRecordInsertOrderRo } from '@teable/openapi';
import { createRecords, deleteRecord } from '@teable/openapi';
import { CellValue, getFileCover } from '@teable/sdk/components';
import { useFieldStaticGetter, useTableId, useViewId } from '@teable/sdk/hooks';
import type { Record } from '@teable/sdk/model';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  cn,
} from '@teable/ui-lib/shadcn';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { tableConfig } from '@/features/i18n/table.config';
import type { IKanbanContext } from '../context';
import { useKanban } from '../hooks';
import type { IStackData } from '../type';
import { CARD_COVER_HEIGHT, getCellValueByStack } from '../utils';

interface IKanbanCardProps {
  stack: IStackData;
  card: Record;
  provided: DraggableProvided;
  isDragging?: boolean;
}

export const KanbanCard = (props: IKanbanCardProps) => {
  const { stack, card, provided, isDragging } = props;
  const tableId = useTableId();
  const viewId = useViewId();
  const getFieldStatic = useFieldStaticGetter();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const {
    permission,
    stackField,
    primaryField,
    displayFields,
    coverField,
    isCoverFit,
    isFieldNameHidden,
    setExpandRecordId,
  } = useKanban() as Required<IKanbanContext>;

  const { cardCreatable, cardDeletable } = permission;
  const { id: fieldId } = stackField;
  const coverFieldId = coverField?.id;
  const coverCellValue = card.getCellValue(coverFieldId as string) as
    | IAttachmentCellValue
    | undefined;

  const titleComponent = useMemo(() => {
    if (primaryField == null) return t('untitled');
    const value = card.getCellValue(primaryField.id);
    if (value == null) return t('untitled');
    return <CellValue field={primaryField} value={value} className="text-base" />;
  }, [card, primaryField, t]);

  const onExpand = () => {
    setExpandRecordId(card.id);
  };

  const onDelete = () => {
    if (tableId == null) return;
    deleteRecord(tableId, card.id);
  };

  const onInsert = async (position: IRecordInsertOrderRo['position']) => {
    if (tableId == null || viewId == null) return;
    const cellValue = getCellValueByStack(stack);
    const res = await createRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      records: [
        {
          fields: { [fieldId]: cellValue },
        },
      ],
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
        <div ref={provided.innerRef} {...provided.draggableProps} className="w-full px-3 pb-2">
          <div
            {...provided.dragHandleProps}
            className={cn(
              'relative flex w-full grow flex-col space-y-2 overflow-hidden rounded-md border border-input bg-background p-3',
              isDragging && 'shadow-md'
            )}
            onClick={onExpand}
          >
            {coverCellValue?.length && (
              <Carousel
                opts={{
                  watchDrag: false,
                  watchResize: false,
                  watchSlides: false,
                }}
              >
                <CarouselContent className="ml-0">
                  {coverCellValue.map(({ id, mimetype, presignedUrl, lgThumbnailUrl }) => {
                    const url = lgThumbnailUrl ?? getFileCover(mimetype, presignedUrl);
                    return (
                      <CarouselItem
                        key={id}
                        style={{ height: CARD_COVER_HEIGHT }}
                        className="relative w-full pl-0"
                      >
                        <img
                          src={url}
                          alt="card cover"
                          style={{
                            objectFit: isCoverFit ? 'contain' : 'cover',
                            width: '100%',
                            height: '100%',
                          }}
                        />
                      </CarouselItem>
                    );
                  })}
                </CarouselContent>
                <CarouselPrevious className="left-1" onClick={(e) => e.stopPropagation()} />
                <CarouselNext className="right-1" onClick={(e) => e.stopPropagation()} />
              </Carousel>
            )}
            <div className="text-base font-semibold">{titleComponent}</div>
            {displayFields.map((field) => {
              const { id: fieldId, name, type, isLookup } = field;
              const { Icon } = getFieldStatic(type, isLookup);
              const cellValue = card.getCellValue(fieldId);

              if (cellValue == null) return null;

              return (
                <div key={fieldId}>
                  {!isFieldNameHidden && (
                    <div className="mb-1 flex items-center space-x-1 text-slate-500 dark:text-slate-400">
                      <Icon className="text-sm" />
                      <span className="text-xs">{name}</span>
                    </div>
                  )}
                  <CellValue field={field} value={cellValue} maxLine={4} />
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
              <Trash className="mr-2 size-4" />
              {t('table:kanban.cardMenu.deleteCard')}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
};
