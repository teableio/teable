import type { DropResult } from '@hello-pangea/dnd';
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import type { ISelectFieldChoice, ISelectFieldOptions } from '@teable/core';
import { ColorUtils } from '@teable/core';
import { DraggableHandle, Plus, Trash2 } from '@teable/icons';
import { cn, Label, Switch } from '@teable/ui-lib/shadcn';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import { useTranslation } from 'next-i18next';
import { useMemo, useRef } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';
import { Virtuoso } from 'react-virtuoso';
import { HeightPreservingItem } from '@/features/app/blocks/view/kanban/components/KanbanStack';
import { tableConfig } from '@/features/i18n/table.config';
import { ChoiceItem } from './ChoiceItem';
import { SelectDefaultValue } from './SelectDefaultValue';

const getChoiceId = (choice: ISelectFieldChoice, index: number) => {
  const { id, color, name } = choice;
  return id ?? `${color}-${name}-${index}`;
};

export const SelectOptions = (props: {
  isMultiple: boolean;
  options: Partial<ISelectFieldOptions> | undefined;
  isLookup?: boolean;
  onChange?: (options: Partial<ISelectFieldOptions>) => void;
}) => {
  const { isMultiple, options, isLookup, onChange } = props;
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const choices = useMemo(() => options?.choices ?? [], [options?.choices]);

  const updateOptionChange = (index: number, key: keyof ISelectFieldChoice, value: string) => {
    const newChoice = choices.map((v, i) => {
      if (i === index) {
        return {
          ...v,
          [key]: value,
        };
      }
      return v;
    });
    onChange?.({ choices: newChoice });
  };

  const onDefaultValueChange = (defaultValue: string | string[] | undefined) => {
    onChange?.({ defaultValue });
  };

  const onPreventAutoNewOptionsChange = (checked: boolean) => {
    onChange?.({ preventAutoNewOptions: checked });
  };

  const deleteChoice = (index: number) => {
    onChange?.({
      choices: choices.filter((_, i) => i !== index),
    });
  };

  const addOption = () => {
    const existColors = choices.map((v) => v.color);
    const choice = {
      name: '',
      color: ColorUtils.randomColor(existColors)[0],
    } as ISelectFieldChoice;

    const newChoices = [...choices, choice];
    onChange?.({ choices: newChoices });
    setTimeout(() => {
      virtuosoRef.current?.scrollToIndex({ index: 'LAST' });
      setTimeout(() => inputRefs.current[choices.length]?.focus(), 150);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !isLookup) {
      addOption();
    }
  };

  const onDragEnd = async (result: DropResult) => {
    const { source, destination } = result;

    if (!destination) return;

    const { index: from } = source;
    const { index: to } = destination;
    const list = [...choices];
    const [choice] = list.splice(from, 1);

    list.splice(to, 0, choice);

    onChange?.({ choices: list });
  };

  return (
    <div className="flex grow flex-col space-y-2">
      <div className="grow" style={{ maxHeight: choices.length * 36 }}>
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable
            droppableId={'select-choice-container'}
            mode="virtual"
            renderClone={(provided, snapshot, rubric) => {
              const choice = choices[rubric.source.index];
              const { draggableProps } = provided;
              return (
                <div
                  ref={provided.innerRef}
                  {...draggableProps}
                  className={cn('py-1', isLookup && 'cursor-default')}
                >
                  <div className="flex items-center">
                    {!isLookup && <DraggableHandle className="mr-1 size-4 cursor-grabbing" />}
                    <ChoiceItem
                      choice={choice}
                      readonly={isLookup}
                      onChange={(key, value) => updateOptionChange(0, key, value)}
                      onKeyDown={onKeyDown}
                      onInputRef={(el) => (inputRefs.current[0] = el)}
                    />
                    {!isLookup && (
                      <Button
                        variant={'ghost'}
                        className="size-6 rounded-full p-0 focus-visible:ring-transparent focus-visible:ring-offset-0"
                        onClick={() => deleteChoice(0)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            }}
          >
            {(provided) => (
              <Virtuoso
                ref={virtuosoRef}
                scrollerRef={provided.innerRef as never}
                className="size-full"
                totalCount={choices.length}
                overscan={5}
                components={{
                  Item: HeightPreservingItem as never,
                }}
                itemContent={(index) => {
                  const choice = choices[index];
                  if (choice == null) {
                    return null;
                  }
                  return (
                    <Draggable
                      draggableId={getChoiceId(choice, index)}
                      index={index}
                      key={getChoiceId(choice, index)}
                    >
                      {(draggableProvided) => {
                        const { draggableProps, dragHandleProps } = draggableProvided;

                        return (
                          <div
                            ref={draggableProvided.innerRef}
                            {...draggableProps}
                            className={cn('py-1', isLookup && 'cursor-default')}
                          >
                            <div className="flex items-center">
                              {!isLookup && (
                                <div {...dragHandleProps} className="mr-1 size-4">
                                  <DraggableHandle className="size-4 cursor-grabbing" />
                                </div>
                              )}
                              <ChoiceItem
                                choice={choice}
                                readonly={isLookup}
                                onChange={(key, value) => updateOptionChange(index, key, value)}
                                onKeyDown={onKeyDown}
                                onInputRef={(el) => (inputRefs.current[index] = el)}
                              />
                              {!isLookup && (
                                <Button
                                  variant={'ghost'}
                                  className="size-6 rounded-full p-0 focus-visible:ring-transparent focus-visible:ring-offset-0"
                                  onClick={() => deleteChoice(index)}
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      }}
                    </Draggable>
                  );
                }}
              />
            )}
          </Droppable>
        </DragDropContext>
      </div>
      {!isLookup && (
        <div className="flex flex-col gap-4">
          <div className="shrink-0">
            <Button
              className="w-full gap-2 text-sm font-normal"
              size={'sm'}
              variant={'outline'}
              onClick={addOption}
            >
              <Plus className="size-4" />
              {t('table:field.editor.addOption')}
            </Button>
          </div>
          <div className="flex gap-2">
            <Switch
              id="allow-auto-new-options"
              checked={!options?.preventAutoNewOptions}
              onCheckedChange={(checked) => {
                onPreventAutoNewOptionsChange(!checked);
              }}
            />
            <Label htmlFor="allow-auto-new-options" className="font-normal leading-tight">
              {t('table:field.editor.allowNewOptionsWhenEditing')}
            </Label>
          </div>
          <div className="flex items-center justify-between">
            <SelectDefaultValue
              isMultiple={isMultiple}
              onChange={onDefaultValueChange}
              options={options}
            />
          </div>
        </div>
      )}
    </div>
  );
};
