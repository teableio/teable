import { FieldType } from '@teable/core';
import type { ISelectFieldOptions, ISelectFieldChoice } from '@teable/core';
import { ChevronDown, Minimize2, Pencil, Trash2 } from '@teable/icons';
import { generateLocalId } from '@teable/sdk/components';
import { useTableId, useViewId } from '@teable/sdk/hooks';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@teable/ui-lib';
import { isEqual } from 'lodash';
import type { Dispatch, SetStateAction } from 'react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useClickAway } from 'react-use';
import { ChoiceItem } from '@/features/app/components/field-setting/options/SelectOptions';
import { tableConfig } from '@/features/i18n/table.config';
import type { IKanbanContext } from '../context';
import { useKanban } from '../hooks';
import { useKanbanStackCollapsedStore } from '../store';
import type { IStackData } from '../type';
import { KanbanStackTitle } from './KanbanStackTitle';

interface IKanbanStackHeaderProps {
  stack: IStackData;
  isUncategorized?: boolean;
  setEditMode: Dispatch<SetStateAction<boolean>>;
}

export const KanbanStackHeader = (props: IKanbanStackHeaderProps) => {
  const { stack, isUncategorized, setEditMode } = props;

  const tableId = useTableId();
  const viewId = useViewId();
  const { collapsedStackMap, setCollapsedStackMap } = useKanbanStackCollapsedStore();
  const { permission, stackField } = useKanban() as Required<IKanbanContext>;
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const { type, options, isLookup } = stackField;
  const { id: stackId, data: stackData } = stack;
  const { stackEditable, stackDeletable } = permission;
  const isSingleSelectField = type === FieldType.SingleSelect && !isLookup;
  const choices = (options as ISelectFieldOptions)?.choices ?? [];

  const choiceRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | null>();
  const [renamingChoice, setRenamingChoice] = useState<ISelectFieldChoice | null>();

  const onStackRename = () => {
    if (!stackEditable) return;

    const curChoice = choices.find((choice) => choice.name === stackData);

    if (curChoice == null) return;

    setEditMode(true);
    setRenamingChoice({ ...curChoice });
  };

  const onChange = (key: keyof ISelectFieldChoice, value: string) => {
    setRenamingChoice({
      ...(renamingChoice as ISelectFieldChoice),
      [key]: value,
    });
  };

  const onOptionUpdate = () => {
    const value = inputRef.current?.value;
    const newChoice = { ...renamingChoice, name: value };
    if (!value || isEqual(value, stackData)) return;
    const newChoices = choices.map((choice) => {
      if (choice.name === stackData) return newChoice;
      return choice;
    });
    stackField.convert({
      type,
      options: { ...options, choices: newChoices },
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onOptionUpdate();
      setRenamingChoice(null);
    }
  };

  const onStackDelete = () => {
    const choices = (options as ISelectFieldOptions)?.choices ?? [];
    const newChoices = choices.filter((choice) => choice.name !== stackData);
    stackField.convert({
      type,
      options: { ...options, choices: newChoices },
    });
  };

  const onStackCollapsed = () => {
    const localId = generateLocalId(tableId, viewId);
    const collapsedStackIdSet = new Set(collapsedStackMap[localId] ?? []);
    collapsedStackIdSet.add(stackId);
    setCollapsedStackMap(localId, [...collapsedStackIdSet]);
  };

  useClickAway(choiceRef, () => {
    if (isSingleSelectField) {
      onOptionUpdate();
      setEditMode(false);
      setRenamingChoice(null);
    }
  });

  return (
    <div className="flex h-12 w-full shrink-0 items-center justify-between rounded-t-md border-b bg-background px-4">
      {renamingChoice ? (
        <div ref={choiceRef}>
          <ChoiceItem
            choice={renamingChoice}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onInputRef={(el) => (inputRef.current = el)}
          />
        </div>
      ) : (
        <KanbanStackTitle
          stack={stack}
          isUncategorized={isUncategorized}
          onClick={() => {
            if (!isSingleSelectField) return;
            onStackRename();
            setTimeout(() => inputRef.current?.focus());
          }}
        />
      )}
      <DropdownMenu>
        <DropdownMenuTrigger>
          <ChevronDown className="size-5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-52"
          onCloseAutoFocus={(e) => {
            if (isSingleSelectField) {
              e.preventDefault();
              inputRef.current?.focus();
            }
          }}
        >
          <DropdownMenuItem className="cursor-pointer" onClick={onStackCollapsed}>
            <Minimize2 className="mr-2 size-4" />
            {t('table:kanban.stackMenu.collapseStack')}
          </DropdownMenuItem>
          {isSingleSelectField && !isUncategorized && (
            <>
              {stackEditable && (
                <DropdownMenuItem className="cursor-pointer" onClick={onStackRename}>
                  <Pencil className="mr-2 size-4" />
                  {t('table:kanban.stackMenu.renameStack')}
                </DropdownMenuItem>
              )}
              {stackDeletable && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="cursor-pointer text-destructive focus:text-destructive"
                    onClick={onStackDelete}
                  >
                    <Trash2 className="mr-2 size-4" />
                    {t('table:kanban.stackMenu.deleteStack')}
                  </DropdownMenuItem>
                </>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
