import { DraggableHandle } from '@teable/icons';
import type { DragEndEvent } from '@teable/ui-lib';
import {
  Switch,
  Label,
  Button,
  Popover,
  PopoverTrigger,
  PopoverContent,
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
} from '@teable/ui-lib';
import { map } from 'lodash';
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from '../../context/app/i18n';
import { useFieldStaticGetter } from '../../hooks';
import type { IFieldInstance } from '../../model';

interface IHideFieldsBaseProps {
  fields: IFieldInstance[];
  hidden: string[];
  footer?: React.ReactNode;
  children: React.ReactNode;
  onChange: (hidden: string[]) => void;
  onOrderChange?: (fieldId: string, fromIndex: number, toIndex: number) => void;
}

export const HideFieldsBase = (props: IHideFieldsBaseProps) => {
  const { fields, hidden, footer, children, onChange, onOrderChange } = props;
  const { t } = useTranslation();
  const fieldStaticGetter = useFieldStaticGetter();

  const [innerFields, setInnerFields] = useState([...fields]);
  const [dragHandleVisible, setDragHandleVisible] = useState(true);
  const dragEnabled = Boolean(onOrderChange) && dragHandleVisible;

  useEffect(() => {
    setInnerFields([...fields]);
  }, [fields]);

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
    <div className="rounded-lg p-1">
      <Command filter={commandFilter}>
        <CommandInput
          placeholder={t('common.search.placeholder')}
          className="h-8 text-xs"
          onValueChange={(value) => searchHandle(value)}
        />
        <CommandList className="my-2 max-h-64">
          <CommandEmpty>{t('common.search.empty')}</CommandEmpty>
          <DndKitContext onDragEnd={dragEndHandler}>
            <Droppable items={innerFields.map(({ id }) => ({ id }))}>
              {innerFields.map((field) => {
                const { id, name, type, isLookup, isPrimary, aiConfig, canReadFieldRecord } = field;
                const { Icon } = fieldStaticGetter(type, {
                  isLookup,
                  hasAiConfig: Boolean(aiConfig),
                  deniedReadRecord: !canReadFieldRecord,
                });
                return (
                  <Draggable key={id} id={id} disabled={!dragEnabled}>
                    {({ setNodeRef, listeners, attributes, style, isDragging }) => (
                      <>
                        {
                          <CommandItem
                            className="flex flex-1 p-0"
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
                                  <div className="flex flex-1 items-center p-0">
                                    <Label
                                      htmlFor={id}
                                      className="flex flex-1 cursor-pointer items-center truncate p-2"
                                    >
                                      <Switch
                                        id={id}
                                        className="scale-75"
                                        checked={statusMap[id]}
                                        onCheckedChange={(checked) => {
                                          switchChange(id, checked);
                                        }}
                                        disabled={isPrimary}
                                      />
                                      <Icon className="ml-2 size-4 shrink-0" />
                                      <span className="h-full flex-1 cursor-pointer truncate pl-1 text-sm">
                                        {name}
                                      </span>
                                    </Label>
                                    {/* forbid drag when search */}
                                    {dragEnabled && (
                                      <div {...attributes} {...listeners} className="pr-1">
                                        <DraggableHandle></DraggableHandle>
                                      </div>
                                    )}
                                  </div>
                                </TooltipTrigger>
                                {isPrimary ? (
                                  <TooltipContent>
                                    <pre>{t('hidden.primaryKey')}</pre>
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
      {dragHandleVisible && (
        <div className="flex justify-between p-2">
          <Button
            variant="secondary"
            size="xs"
            className="w-32 text-muted-foreground hover:text-secondary-foreground"
            onClick={showAll}
          >
            {t('hidden.showAll')}
          </Button>
          <Button
            variant="secondary"
            size="xs"
            className="w-32 text-muted-foreground hover:text-secondary-foreground"
            onClick={hideAll}
          >
            {t('hidden.hideAll')}
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <Popover modal>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="p-0">
        {content()}
        {footer}
      </PopoverContent>
    </Popover>
  );
};
