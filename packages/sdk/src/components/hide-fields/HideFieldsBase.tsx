import { DraggableHandle } from '@teable/icons';
import type { DragEndEvent } from '@teable/ui-lib';
import {
  Switch,
  Label,
  Button,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  DndKitContext,
  Draggable,
  Droppable,
  cn,
} from '@teable/ui-lib';
import { map } from 'lodash';
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from '../../context/app/i18n';
import { useFieldStaticGetter } from '../../hooks';
import type { IFieldInstance } from '../../model';
import { AdaptivePanel, useIsDrawerPanel } from '../adaptive-panel';
import { ReadOnlyTip } from '../ReadOnlyTip';

interface IHideFieldsBaseProps {
  fields: IFieldInstance[];
  hidden: string[];
  footer?: React.ReactNode;
  children: React.ReactNode;
  onChange: (hidden: string[]) => void;
  onOrderChange?: (fieldId: string, fromIndex: number, toIndex: number) => void;
  onFieldClick?: (field: IFieldInstance) => void;
  /**
   * Render as a bottom drawer on narrow viewports. Off by default: this panel
   * is also embedded in the link-field settings, where a full-height drawer
   * titled "Hidden fields" inside the field editor would be a second floating
   * layer on top of the first.
   */
  responsive?: boolean;
  /** Drawer heading. Defaults to the "Hidden fields" label. */
  title?: string;
}

export const HideFieldsBase = (props: IHideFieldsBaseProps) => {
  const {
    fields,
    hidden,
    footer,
    children,
    responsive,
    title,
    onChange,
    onOrderChange,
    onFieldClick,
  } = props;
  const { t } = useTranslation();
  const fieldStaticGetter = useFieldStaticGetter();
  const isDrawer = useIsDrawerPanel(responsive);

  const [isOpen, setIsOpen] = useState(false);
  const [innerFields, setInnerFields] = useState([...fields]);
  const [dragHandleVisible, setDragHandleVisible] = useState(true);
  const dragEnabled = Boolean(onOrderChange) && dragHandleVisible;

  useEffect(() => {
    setInnerFields([...fields]);
  }, [fields]);

  useEffect(() => {
    // Crossing the breakpoint swaps popover for drawer, which remounts the
    // panel body and clears the search box - but not this flag, which would
    // otherwise leave the footer and drag handles hidden with an empty search.
    setDragHandleVisible(true);
  }, [isDrawer]);

  const statusMap = useMemo(() => {
    return fields.reduce(
      (acc, field) => {
        acc[field.id] = !hidden.includes(field.id);
        return acc;
      },
      {} as Record<string, boolean>
    );
  }, [fields, hidden]);

  const switchChange = (id: string, checked: boolean) => {
    if (checked) {
      onChange(hidden.filter((fieldId) => fieldId !== id));
      return;
    }
    onChange([...hidden, id]);
  };

  const showAll = () => {
    onChange([]);
  };

  const hideAll = () => {
    const hiddenFields = fields.filter((field) => !field.isPrimary);
    onChange(map(hiddenFields, 'id'));
  };

  const dragEndHandler = (event: DragEndEvent) => {
    const { over, active } = event;
    const to = over?.data?.current?.sortable?.index;
    const from = active?.data?.current?.sortable?.index;

    if (!over || to === from) {
      return;
    }

    const list = [...fields];
    const [field] = list.splice(from, 1);
    list.splice(to, 0, field);
    setInnerFields(list);

    onOrderChange?.(field.id, from, to);
  };

  const commandFilter = useCallback(
    (fieldId: string, searchValue: string) => {
      const currentField = fields.find(
        ({ id }) => fieldId.toLocaleLowerCase() === id.toLocaleLowerCase()
      );
      const name = currentField?.name?.toLocaleLowerCase() || t('common.untitled');
      const containWord = name.indexOf(searchValue.toLowerCase()) > -1;
      return Number(containWord);
    },
    [fields, t]
  );

  const searchHandle = (value: string) => {
    setDragHandleVisible(!value);
  };

  const content = () => (
    <div className={cn('rounded-lg', isDrawer && 'flex h-full flex-col rounded-none')}>
      <Command filter={commandFilter} className={cn(isDrawer && 'h-full bg-transparent')}>
        <CommandInput
          placeholder={t('common.search.placeholder')}
          className={cn('h-10 text-xs', isDrawer && 'h-8 text-sm')}
          containerClassName={cn(
            isDrawer && 'mx-4 mb-1 mt-4 h-8 shrink-0 gap-2 rounded-md border border-input px-3 py-0'
          )}
          onValueChange={(value) => searchHandle(value)}
        />
        {/* The 280px cap is a popover concern; in a drawer the list fills the
            panel and the 85vh cap does the bounding. */}
        <CommandList className={cn('max-h-[280px] p-2', isDrawer && 'max-h-full flex-1')}>
          <CommandEmpty>{t('common.search.empty')}</CommandEmpty>
          <DndKitContext onDragEnd={dragEndHandler}>
            <Droppable items={innerFields.map(({ id }) => ({ id }))}>
              {innerFields.map((field) => {
                const { id, name, type, isLookup, isPrimary, aiConfig, canReadFieldRecord } = field;
                const { Icon } = fieldStaticGetter(type, {
                  isLookup,
                  isConditionalLookup: field.isConditionalLookup,
                  hasAiConfig: Boolean(aiConfig),
                  deniedReadRecord: !canReadFieldRecord,
                });
                const handleFieldClick = () => {
                  if (onFieldClick) {
                    // In the grid this scrolls to the column and flashes it -
                    // pointless while a full-width drawer is covering the grid,
                    // so step out of the way first.
                    if (isDrawer) setIsOpen(false);
                    onFieldClick(field);
                    return;
                  }
                  if (!isPrimary) {
                    switchChange(id, !statusMap[id]);
                  }
                };
                return (
                  <Draggable key={id} id={id} disabled={!dragEnabled}>
                    {({ setNodeRef, listeners, attributes, style, isDragging }) => (
                      <>
                        {
                          <CommandItem
                            className="flex flex-1 rounded-md p-0"
                            key={id}
                            value={id}
                            ref={setNodeRef}
                            style={{
                              ...style,
                              opacity: isDragging ? '0.6' : '1',
                            }}
                          >
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex flex-1 cursor-pointer items-center truncate p-0">
                                    <Label
                                      htmlFor={id}
                                      className="flex cursor-pointer items-center p-2"
                                    >
                                      <Switch
                                        id={id}
                                        size="sm"
                                        checked={statusMap[id]}
                                        onCheckedChange={(checked) => {
                                          switchChange(id, checked);
                                        }}
                                        disabled={isPrimary}
                                      />
                                    </Label>
                                    <button
                                      type="button"
                                      className="flex min-w-0 flex-1 items-center truncate py-2 pe-2 text-start"
                                      onClick={handleFieldClick}
                                    >
                                      <Icon className="size-4 shrink-0" />
                                      <span className="h-full flex-1 cursor-pointer truncate ps-1 text-sm">
                                        {name}
                                      </span>
                                    </button>
                                    {/* forbid drag when search */}
                                    {dragEnabled && (
                                      <div
                                        {...attributes}
                                        {...listeners}
                                        className="touch-none pe-2"
                                      >
                                        <DraggableHandle></DraggableHandle>
                                      </div>
                                    )}
                                  </div>
                                </TooltipTrigger>
                                {isPrimary ? (
                                  <TooltipContent className="max-w-[360px]">
                                    <span className="whitespace-normal break-words">
                                      {t('hidden.primaryKey')}
                                    </span>
                                  </TooltipContent>
                                ) : null}
                              </Tooltip>
                            </TooltipProvider>
                          </CommandItem>
                        }
                      </>
                    )}
                  </Draggable>
                );
              })}
            </Droppable>
          </DndKitContext>
        </CommandList>
      </Command>
    </div>
  );

  const bulkActions = dragHandleVisible ? (
    <div className="flex justify-between gap-3 border-t px-4 pb-4 pt-3">
      {/* Two fixed 128px buttons on desktop; on a 320px screen they split the
          row instead, so a long translation truncates rather than overflows. */}
      <Button
        variant="outline"
        size="xs"
        className={cn('w-32', isDrawer && 'w-auto flex-1')}
        onClick={showAll}
      >
        <span className="truncate">{t('hidden.showAll')}</span>
      </Button>
      <Button
        variant="outline"
        size="xs"
        className={cn('w-32', isDrawer && 'w-auto flex-1')}
        onClick={hideAll}
      >
        <span className="truncate">{t('hidden.hideAll')}</span>
      </Button>
    </div>
  ) : null;

  return (
    <AdaptivePanel
      responsive={responsive}
      open={isOpen}
      onOpenChange={setIsOpen}
      modal
      title={title ?? t('hidden.label')}
      popoverClassName="relative rounded-lg p-0"
      // Searchable list: pin the height so filtering does not resize the panel
      // under the finger that is typing.
      drawerSize="list"
      bodyClassName="overflow-hidden"
      footerClassName="border-t-0 p-0"
      overlay={<ReadOnlyTip />}
      content={content()}
      footer={
        bulkActions || footer ? (
          <>
            {bulkActions}
            {footer}
          </>
        ) : undefined
      }
    >
      {children}
    </AdaptivePanel>
  );
};
