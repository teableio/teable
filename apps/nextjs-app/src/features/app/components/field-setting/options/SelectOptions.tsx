import type { DragEndEvent, DragStartEvent, UniqueIdentifier } from '@dnd-kit/core';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ISelectFieldChoice, ISelectFieldOptions, Colors } from '@teable-group/core';
import { COLOR_PALETTE, ColorUtils } from '@teable-group/core';
import { DraggableHandle, Plus, Trash } from '@teable-group/icons';
import { Input } from '@teable-group/ui-lib/shadcn';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@teable-group/ui-lib/shadcn/ui/popover';
import classNames from 'classnames';
import { useMemo, useRef, useState } from 'react';

interface IOptionItemProps {
  choice: ISelectFieldChoice;
  index: number;
  readonly?: boolean;
  onChange: (index: number, key: keyof ISelectFieldChoice, value: string) => void;
  onDelete: (index: number) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onInputRef: (el: HTMLInputElement | null, index: number) => void;
}

const getChoiceId = (choice: ISelectFieldChoice) => {
  const { id, color, name } = choice;
  return id ?? `${color}-${name}`;
};

export const SelectOptions = (props: {
  options: Partial<ISelectFieldOptions> | undefined;
  isLookup?: boolean;
  onChange?: (options: Partial<ISelectFieldOptions>) => void;
}) => {
  const { options, isLookup, onChange } = props;
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [draggingId, setDraggingId] = useState<UniqueIdentifier | null>('');

  const choices = useMemo(() => options?.choices ?? [], [options?.choices]);
  const choiceIds = useMemo(() => choices.map((choice) => getChoiceId(choice)), [choices]);

  const sensors = useSensors(
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    }),
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

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
      inputRefs.current[choices.length]?.focus();
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !isLookup) {
      addOption();
    }
  };

  const onDragStart = (event: DragStartEvent) => {
    const { active } = event;
    setDraggingId(active.id);
  };

  const onDragEnd = async (event: DragEndEvent) => {
    const { over, active } = event;

    if (!over) return;

    const from = active?.data?.current?.sortable?.index;
    const to = over?.data?.current?.sortable?.index;
    const list = [...choices];
    const [choice] = list.splice(from, 1);

    list.splice(to, 0, choice);

    onChange?.({ choices: list });
    setDraggingId(null);
  };

  const overLayRender = () => {
    const choiceIndex = choices.findIndex((choice) => getChoiceId(choice) === draggingId);
    if (choiceIndex === -1) return null;
    const choice = choices[choiceIndex];
    return (
      <div className="flex cursor-grabbing items-center">
        <DraggableHandle className="mr-1 h-4 w-4" />
        <ChoiceItem
          choice={choice}
          index={choiceIndex}
          readonly={isLookup}
          onChange={updateOptionChange}
          onDelete={deleteChoice}
          onKeyDown={onKeyDown}
          onInputRef={(el, index) => (inputRefs.current[index] = el)}
        />
      </div>
    );
  };

  return (
    <ul className="space-y-2">
      <DndContext onDragStart={onDragStart} onDragEnd={onDragEnd} sensors={sensors}>
        <SortableContext items={choiceIds}>
          {choices.map((choice, i) => {
            const { name } = choice;
            return (
              <DraggableContainer
                key={`${name}-${i}`}
                id={getChoiceId(choice)}
                index={i}
                disabled={isLookup}
              >
                <ChoiceItem
                  choice={choice}
                  index={i}
                  readonly={isLookup}
                  onChange={updateOptionChange}
                  onDelete={deleteChoice}
                  onKeyDown={onKeyDown}
                  onInputRef={(el, index) => (inputRefs.current[index] = el)}
                />
              </DraggableContainer>
            );
          })}
          {<DragOverlay>{overLayRender()}</DragOverlay>}
        </SortableContext>
      </DndContext>
      {!isLookup && (
        <li className="mt-1">
          <Button
            className="w-full gap-2 text-sm font-normal"
            size={'sm'}
            variant={'outline'}
            onClick={addOption}
          >
            <Plus className="h-4 w-4" />
            Add option
          </Button>
        </li>
      )}
    </ul>
  );
};

const DraggableContainer = (props: {
  children: React.ReactElement;
  id: string;
  index: number;
  disabled?: boolean;
}) => {
  const { id, index, disabled, children } = props;
  const dragProps = useSortable({ id, data: { index }, disabled });
  const { setNodeRef, transition, transform, attributes, listeners, isDragging } = dragProps;
  const style = {
    transition,
    transform: CSS.Transform.toString(transform),
  };

  return (
    <div
      style={style}
      ref={setNodeRef}
      {...attributes}
      className={classNames(
        'flex items-center',
        isDragging ? 'opacity-60' : null,
        disabled && 'cursor-default'
      )}
    >
      {!disabled && <DraggableHandle {...listeners} className="mr-1 h-4 w-4 cursor-grabbing" />}
      {children}
    </div>
  );
};

const ChoiceItem = (props: IOptionItemProps) => {
  const { choice, index, readonly, onChange, onDelete, onKeyDown, onInputRef } = props;
  const { color, name } = choice;
  const bgColor = ColorUtils.getHexForColor(color);

  return (
    <li className="flex grow items-center">
      {readonly ? (
        <div className="h-auto rounded-full border-2 p-[2px]" style={{ borderColor: bgColor }}>
          <div style={{ backgroundColor: bgColor }} className="h-3 w-3 rounded-full" />
        </div>
      ) : (
        <Popover>
          <PopoverTrigger>
            <Button
              variant={'ghost'}
              className="h-auto rounded-full border-2 p-[2px]"
              style={{ borderColor: bgColor }}
            >
              <div style={{ backgroundColor: bgColor }} className="h-3 w-3 rounded-full" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2">
            <ColorPicker color={color} onSelect={(color) => onChange(index, 'color', color)} />
          </PopoverContent>
        </Popover>
      )}
      <div className="flex-1 px-2">
        <ChoiceInput
          reRef={(el) => onInputRef(el, index)}
          name={name}
          readOnly={readonly}
          onKeyDown={onKeyDown}
          onChange={(value) => onChange(index, 'name', value)}
        />
      </div>
      {!readonly && (
        <Button
          variant={'ghost'}
          className="h-6 w-6 rounded-full p-0 focus-visible:ring-transparent focus-visible:ring-offset-0"
          onClick={() => onDelete(index)}
        >
          <Trash className="h-4 w-4" />
        </Button>
      )}
    </li>
  );
};

const ChoiceInput: React.FC<{
  reRef: React.Ref<HTMLInputElement>;
  readOnly?: boolean;
  name: string;
  onChange: (name: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}> = ({ name, readOnly, onChange, onKeyDown, reRef }) => {
  const [value, setValue] = useState<string>(name);
  return (
    <Input
      ref={reRef}
      className="h-7"
      type="text"
      value={value}
      readOnly={readOnly}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onChange(value)}
      onKeyDown={onKeyDown}
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
                  className={classNames('p-1 my-1 rounded-full h-auto', {
                    'border-2 p-[2px]': color === c,
                  })}
                  style={{ borderColor: bg }}
                  onClick={() => onSelect(c)}
                >
                  <div
                    style={{
                      backgroundColor: bg,
                    }}
                    className="h-4 w-4 rounded-full"
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
