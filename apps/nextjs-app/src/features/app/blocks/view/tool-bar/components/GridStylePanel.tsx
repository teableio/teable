import type { IGridRowColorOptions, IGridStyleOptions, ISelectFieldOptions } from '@teable/core';
import { ColorUtils, FieldType } from '@teable/core';
import { useFields } from '@teable/sdk/hooks';
import {
  Checkbox,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Switch,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import { GridColorRuleDialog } from './GridColorRuleDialog';

interface IGridStylePanelProps {
  style?: IGridStyleOptions;
  children: ReactNode;
  onChange: (style: IGridStyleOptions) => Promise<unknown>;
}

export const GridStylePanel = ({ style, children, onChange }: IGridStylePanelProps) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const [draftStyle, setDraftStyle] = useState<IGridStyleOptions>(style ?? {});
  const latestStyleRef = useRef(style);
  const updateVersionRef = useRef(0);
  const pendingUpdatesRef = useRef(0);
  const hasDeferredExternalStyleRef = useRef(false);

  useEffect(() => {
    latestStyleRef.current = style;
    if (pendingUpdatesRef.current > 0) {
      hasDeferredExternalStyleRef.current = true;
      return;
    }
    setDraftStyle(style ?? {});
  }, [style]);

  const commitStyle = (nextStyle: IGridStyleOptions) => {
    const version = ++updateVersionRef.current;
    pendingUpdatesRef.current += 1;
    setDraftStyle(nextStyle);
    void onChange(nextStyle)
      .catch(() => {
        if (version === updateVersionRef.current) {
          setDraftStyle(latestStyleRef.current ?? {});
        }
      })
      .finally(() => {
        pendingUpdatesRef.current -= 1;
        if (pendingUpdatesRef.current === 0 && hasDeferredExternalStyleRef.current) {
          hasDeferredExternalStyleRef.current = false;
          setDraftStyle(latestStyleRef.current ?? nextStyle);
        }
      });
  };

  const allFields = useFields({ withHidden: true });
  const selectFields = useMemo(
    () =>
      allFields.filter(
        (field) =>
          (field.type === FieldType.SingleSelect || field.type === FieldType.MultipleSelect) &&
          !field.isLookup &&
          !field.isConditionalLookup
      ),
    [allFields]
  );
  const rowColor = draftStyle.rowColor;
  const selectFieldConfig = rowColor?.selectField;
  const selectedField = selectFields.find((field) => field.id === selectFieldConfig?.fieldId);
  const choices = useMemo(
    () => (selectedField?.options as ISelectFieldOptions | undefined)?.choices ?? [],
    [selectedField]
  );
  const enabledChoiceIds = selectFieldConfig?.enabledChoiceIds;
  const enabledChoiceIdSet = useMemo(
    () => new Set(enabledChoiceIds ?? choices.map(({ id }) => id)),
    [choices, enabledChoiceIds]
  );

  const onRowColorChange = (nextRowColor: IGridRowColorOptions) => {
    commitStyle({ ...draftStyle, rowColor: nextRowColor });
  };

  const onModeChange = (mode: 'none' | 'selectField' | 'rules') => {
    if (mode === 'none') {
      onRowColorChange({ ...rowColor, mode });
      return;
    }

    if (mode === 'rules') {
      onRowColorChange({ ...rowColor, mode, rules: rowColor?.rules ?? [] });
      return;
    }

    const fieldId = selectFieldConfig?.fieldId ?? selectFields[0]?.id;
    onRowColorChange({
      ...rowColor,
      mode,
      selectField:
        selectFieldConfig ??
        (fieldId
          ? {
              fieldId,
              strategy: 'firstMatched',
            }
          : undefined),
    });
  };

  const onFieldChange = (fieldId: string) => {
    onRowColorChange({
      ...rowColor,
      mode: 'selectField',
      selectField: {
        fieldId,
        strategy: 'firstMatched',
      },
    });
  };

  const onChoiceCheckedChange = (choiceId: string, checked: boolean) => {
    if (!selectFieldConfig) return;

    const nextEnabledChoiceIds = new Set(enabledChoiceIdSet);
    checked ? nextEnabledChoiceIds.add(choiceId) : nextEnabledChoiceIds.delete(choiceId);
    const normalizedChoiceIds = choices
      .map(({ id }) => id)
      .filter((id) => nextEnabledChoiceIds.has(id));

    onRowColorChange({
      ...rowColor,
      mode: 'selectField',
      selectField: {
        ...selectFieldConfig,
        enabledChoiceIds:
          normalizedChoiceIds.length === choices.length ? undefined : normalizedChoiceIds,
      },
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-80 p-0">
        <div className="border-b px-4 py-3 text-sm font-medium">
          {t('table:grid.style.tableStyle')}
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <Label htmlFor="grid-striped-rows" className="text-sm font-normal">
            {t('table:grid.style.stripedRows')}
          </Label>
          <Switch
            id="grid-striped-rows"
            checked={draftStyle.stripedRows ?? false}
            onCheckedChange={(stripedRows) => commitStyle({ ...draftStyle, stripedRows })}
          />
        </div>
        <Separator />
        <div className="flex flex-col gap-3 px-4 py-3">
          <span className="text-sm font-medium">{t('table:grid.style.recordColoring')}</span>
          <Select value={rowColor?.mode ?? 'none'} onValueChange={onModeChange}>
            <SelectTrigger className="bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t('table:grid.style.none')}</SelectItem>
              <SelectItem value="selectField">
                {t('table:grid.style.colorBySelectField')}
              </SelectItem>
              <SelectItem value="rules">{t('table:grid.style.conditionalColoring')}</SelectItem>
            </SelectContent>
          </Select>

          {rowColor?.mode === 'selectField' && (
            <>
              <div className="flex flex-col gap-2">
                <span className="text-xs text-muted-foreground">
                  {t('table:grid.style.selectField')}
                </span>
                <Select
                  value={selectedField?.id}
                  onValueChange={onFieldChange}
                  disabled={!selectFields.length}
                >
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder={t('table:grid.style.noSelectFields')} />
                  </SelectTrigger>
                  <SelectContent>
                    {selectFields.map(({ id, name }) => (
                      <SelectItem key={id} value={id}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedField && (
                <div className="flex flex-col gap-2">
                  <span className="text-xs text-muted-foreground">
                    {t('table:grid.style.coloredChoices')}
                  </span>
                  <div className="max-h-52 overflow-y-auto rounded-md border p-1">
                    {choices.map((choice) => (
                      <Label
                        key={choice.id}
                        htmlFor={`grid-row-color-${choice.id}`}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 font-normal hover:bg-muted"
                      >
                        <Checkbox
                          id={`grid-row-color-${choice.id}`}
                          checked={enabledChoiceIdSet.has(choice.id)}
                          onCheckedChange={(checked) =>
                            onChoiceCheckedChange(choice.id, checked === true)
                          }
                        />
                        <span
                          className="size-3 shrink-0 rounded-full"
                          style={{ backgroundColor: ColorUtils.getHexForColor(choice.color) ?? '' }}
                        />
                        <span className="truncate text-sm">{choice.name}</span>
                      </Label>
                    ))}
                    {!choices.length && (
                      <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                        {t('table:grid.style.noChoices')}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {rowColor?.mode === 'rules' && (
            <GridColorRuleDialog
              rules={rowColor.rules ?? []}
              onChange={(rules) => onRowColorChange({ ...rowColor, mode: 'rules', rules })}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
