/* eslint-disable jsx-a11y/no-static-element-interactions,jsx-a11y/click-events-have-key-events */
import type { IAttachmentCellValue } from '@teable/core';
import { FieldKeyType } from '@teable/core';
import { ArrowDown, ArrowUp, Image, Maximize2, Trash } from '@teable/icons';
import type { IRecordInsertOrderRo } from '@teable/openapi';
import { createRecords, deleteRecord } from '@teable/openapi';
import { CellValue, getFileCover } from '@teable/sdk/components';
import { useAttachmentPreviewI18Map } from '@teable/sdk/components/hooks';
import { useFieldStaticGetter, useTableId, useViewId } from '@teable/sdk/hooks';
import type { Record } from '@teable/sdk/model';
import { FilePreviewItem, FilePreviewProvider } from '@teable/ui-lib/base';
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
} from '@teable/ui-lib/shadcn';
import { Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { tableConfig } from '@/features/i18n/table.config';
import { useGallery } from '../hooks';
import { CARD_COVER_HEIGHT, CARD_STYLE } from '../utils';

interface IKanbanCardProps {
  card: Record;
}

export const Card = (props: IKanbanCardProps) => {
  const { card } = props;
  const tableId = useTableId();
  const viewId = useViewId();
  const getFieldStatic = useFieldStaticGetter();
  const i18nMap = useAttachmentPreviewI18Map();
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
                <FilePreviewProvider i18nMap={i18nMap}>
                  <Carousel
                    opts={{
                      watchDrag: false,
                      watchResize: false,
                      watchSlides: false,
                    }}
                    className="border-b"
                  >
                    <CarouselContent className="ml-0">
                      {coverCellValue.map(
                        ({ id, name, size, mimetype, presignedUrl, lgThumbnailUrl }) => {
                          const url = lgThumbnailUrl ?? getFileCover(mimetype, presignedUrl);
                          return (
                            <CarouselItem
                              key={id}
                              style={{ height: CARD_COVER_HEIGHT }}
                              className="relative size-full pl-0"
                            >
                              <FilePreviewItem
                                key={id}
                                className="size-full cursor-pointer"
                                src={presignedUrl || ''}
                                name={name}
                                mimetype={mimetype}
                                size={size}
                              >
                                <img
                                  src={url}
                                  alt="card cover"
                                  className="size-full"
                                  style={{
                                    objectFit: isCoverFit ? 'contain' : 'cover',
                                  }}
                                />
                              </FilePreviewItem>
                            </CarouselItem>
                          );
                        }
                      )}
                    </CarouselContent>
                    {coverCellValue?.length > 1 && (
                      <Fragment>
                        <CarouselPrevious
                          className="left-1 size-7"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <CarouselNext
                          className="right-1 size-7"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </Fragment>
                    )}
                  </Carousel>
                </FilePreviewProvider>
              ) : (
                <div
                  style={{ height: CARD_COVER_HEIGHT }}
                  className="flex w-full items-center justify-center bg-gray-100 dark:bg-gray-800"
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
