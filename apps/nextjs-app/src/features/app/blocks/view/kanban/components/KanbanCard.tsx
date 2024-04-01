/* eslint-disable jsx-a11y/no-static-element-interactions,jsx-a11y/click-events-have-key-events */
import type { IAttachmentCellValue } from '@teable/core';
import { ArrowDown, ArrowUp, Maximize2, Trash } from '@teable/icons';
import { deleteRecord } from '@teable/openapi';
import { CellValue, getFileCover } from '@teable/sdk/components';
import { useFieldStaticGetter, useTableId } from '@teable/sdk/hooks';
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
} from '@teable/ui-lib/shadcn';
import Image from 'next/image';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { tableConfig } from '@/features/i18n/table.config';
import { useKanban } from '../hooks';
import { CARD_COVER_HEIGHT } from '../utils';

interface IKanbanCardProps {
  card: Record;
}

export const KanbanCard = (props: IKanbanCardProps) => {
  const { card } = props;
  const tableId = useTableId();
  const getFieldStatic = useFieldStaticGetter();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const {
    primaryField,
    displayFields,
    coverField,
    isCoverFit,
    isFieldNameHidden,
    setExpandRecordId,
  } = useKanban();

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

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div
          className="relative flex w-full grow origin-center flex-col space-y-2 overflow-hidden rounded-md border border-input bg-background p-3"
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
                {coverCellValue.map(({ id, mimetype, presignedUrl }) => {
                  const url = getFileCover(mimetype, presignedUrl);

                  return (
                    <CarouselItem
                      key={id}
                      style={{ height: CARD_COVER_HEIGHT }}
                      className="relative w-full"
                    >
                      <Image
                        src={url}
                        alt="card cover"
                        fill
                        sizes="10vw"
                        style={{
                          objectFit: isCoverFit ? 'contain' : 'cover',
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
                <CellValue field={field} value={cellValue} />
              </div>
            );
          })}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem>
          <ArrowUp className="mr-2 size-4" />
          {t('table:kanban.cardMenu.insertCardAbove')}
        </ContextMenuItem>
        <ContextMenuItem>
          <ArrowDown className="mr-2 size-4" />
          {t('table:kanban.cardMenu.insertCardBelow')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onExpand}>
          <Maximize2 className="mr-2 size-4" />
          {t('table:kanban.cardMenu.expandCard')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
          <Trash className="mr-2 size-4" />
          {t('table:kanban.cardMenu.deleteCard')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};
