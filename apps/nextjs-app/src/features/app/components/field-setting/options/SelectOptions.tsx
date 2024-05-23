import type { DropResult } from '@hello-pangea/dnd';
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import type { ISelectFieldChoice, ISelectFieldOptions, Colors } from '@teable/core';
import { COLOR_PALETTE, ColorUtils } from '@teable/core';
import { DraggableHandle, Plus, Trash } from '@teable/icons';
import { Input, cn } from '@teable/ui-lib/shadcn';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib/shadcn/ui/popover';
import { useTranslation } from 'next-i18next';
import { useMemo, useRef, useState } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';
import { Virtuoso } from 'react-virtuoso';
import { HeightPreservingItem } from '@/features/app/blocks/view/kanban/components/KanbanStack';
import { tableConfig } from '@/features/i18n/table.config';

interface IOptionItemProps {
  choice: ISelectFieldChoice;
  readonly?: boolean;
  onChange: (key: keyof ISelectFieldChoice, value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onInputRef?: (el: HTMLInputElement | null) => void;
}

const getChoiceId = (choice: ISelectFieldChoice, index: number) => {
  const { id, color, name } = choice;
  return id ?? `${color}-${name}-${index}`;
};

export const SelectOptions = (props: {
  options: Partial<ISelectFieldOptions> | undefined;
  isLookup?: boolean;
  onChange?: (options: Partial<ISelectFieldOptions>) => void;
}) => {
  const { options, isLookup, onChange } = props;
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
      <div className="grow">
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
                        <Trash className="size-4" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            }}
          >
            {(provided, _snapshot) => (
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
                                  <Trash className="size-4" />
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
        <div className="mt-1 shrink-0">
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
      )}
    </div>
  );
};

export const ChoiceItem = (props: IOptionItemProps) => {
  const { choice, readonly, onChange, onKeyDown, onInputRef } = props;
  const { color, name } = choice;
  const bgColor = ColorUtils.getHexForColor(color);

  return (
    <li className="flex grow items-center">
      {readonly ? (
        <div className="h-auto rounded-full border-2 p-[2px]" style={{ borderColor: bgColor }}>
          <div style={{ backgroundColor: bgColor }} className="size-3 rounded-full" />
        </div>
      ) : (
        <Popover>
          <PopoverTrigger>
            <Button
              variant={'ghost'}
              className="h-auto rounded-full border-2 p-[2px]"
              style={{ borderColor: bgColor }}
            >
              <div style={{ backgroundColor: bgColor }} className="size-3 rounded-full" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2">
            <ColorPicker color={color} onSelect={(color) => onChange('color', color)} />
          </PopoverContent>
        </Popover>
      )}
      <div className="flex-1 px-2">
        <ChoiceInput
          reRef={(el) => onInputRef?.(el)}
          name={name}
          readOnly={readonly}
          onKeyDown={(e) => onKeyDown?.(e)}
          onChange={(value) => onChange('name', value)}
        />
      </div>
    </li>
  );
};

export const ChoiceInput: React.FC<{
  reRef: React.Ref<HTMLInputElement>;
  readOnly?: boolean;
  name: string;
  onChange: (name: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}> = ({ name, readOnly, onChange, onKeyDown, reRef }) => {
  const [value, setValue] = useState<string>(name);
  const onChangeInner = (e: React.ChangeEvent<HTMLInputElement>) => {
    const curValue = e.target.value;
    setValue(curValue);
  };

  return (
    <Input
      ref={reRef}
      className="h-7"
      type="text"
      value={value}
      readOnly={readOnly}
      onChange={onChangeInner}
      onKeyDown={onKeyDown}
      onBlur={() => onChange(value)}
    />
  );
};

export const ColorPicker = ({
  color,
  onSelect,
}: {
  color: Colors;
  onSelect: (color: Colors) => void;
}) => {
  return (
    <div className="flex w-64 flex-wrap p-2">
      {COLOR_PALETTE.map((group, index) => {
        return (
          <div key={index}>
            {group.map((c) => {
              const bg = ColorUtils.getHexForColor(c);

              return (
                <Button
                  key={c}
                  variant={'ghost'}
                  className={cn('p-1 my-1 rounded-full h-auto', {
                    'border-2 p-[2px]': color === c,
                  })}
                  style={{ borderColor: bg }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    onSelect(c);
                  }}
                >
                  <div
                    style={{
                      backgroundColor: bg,
                    }}
                    className="size-4 rounded-full"
                  />
                </Button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};
