import { ColorUtils, type ISelectFieldChoice } from '@teable/core';
import { Plus } from '@teable/icons';
import type { SingleSelectField } from '@teable/sdk/model';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useRef, useState } from 'react';
import { ChoiceItem } from '@/features/app/components/field-setting/options/SelectOptions';
import { tableConfig } from '@/features/i18n/table.config';
import type { IKanbanContext } from '../context';
import { useKanban } from '../hooks';

export const KanbanStackCreator = () => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { stackField } = useKanban() as Required<IKanbanContext>;
  const { type, options } = stackField as SingleSelectField;
  const choices = options?.choices ?? [];

  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<ISelectFieldChoice | null>();
  const inputRef = useRef<HTMLInputElement | null>();

  const onToggle = () => {
    const existColors = choices.map((v) => v.color);
    const newChoice = {
      name: '',
      color: ColorUtils.randomColor(existColors)[0],
    } as ISelectFieldChoice;
    setChoice(newChoice);
    setTimeout(() => inputRef.current?.focus());
  };

  const onChange = (key: keyof ISelectFieldChoice, value: string) => {
    setChoice({
      ...(choice as ISelectFieldChoice),
      [key]: value,
    });
  };

  const onOptionUpdate = () => {
    const value = inputRef.current?.value;
    if (!value) return;
    const newChoices = [...choices, { ...choice, name: value }];
    stackField.convert({
      type,
      options: { ...options, choices: newChoices },
    });
  };

  const onOpenChange = (open: boolean) => {
    if (!open && choice) {
      onOptionUpdate();
    }
    setOpen(open);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onOptionUpdate();
      setChoice(null);
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="lg" className="h-12 text-base" onClick={onToggle}>
          <Plus className="size-5" />
          {t('table:kanban.stack.addStack')}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-64 w-52">
        {choice && (
          <ChoiceItem
            choice={choice}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onInputRef={(el) => (inputRef.current = el)}
          />
        )}
      </PopoverContent>
    </Popover>
  );
};
