import type { IFilter, IGridRowColorRule } from '@teable/core';
import { Colors, ColorUtils, FieldType, getRandomString } from '@teable/core';
import { ArrowDown, ArrowUp, DraggableHandle, Plus, Trash2 } from '@teable/icons';
import { BaseViewFilter, useViewFilterLinkContext } from '@teable/sdk/components';
import { useFields, useTableId, useViewId } from '@teable/sdk/hooks';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
} from '@teable/ui-lib/shadcn';
import { isEqual } from 'lodash';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';

const RULE_COLORS = [
  Colors.RedBright,
  Colors.OrangeBright,
  Colors.YellowBright,
  Colors.GreenBright,
  Colors.TealBright,
  Colors.CyanBright,
  Colors.BlueBright,
  Colors.PurpleBright,
  Colors.PinkBright,
  Colors.GrayBright,
];

const EMPTY_VALUE_OPERATORS = new Set(['isEmpty', 'isNotEmpty']);

const isFilterComplete = (filter: IFilter): boolean =>
  Boolean(
    filter?.filterSet.length &&
      filter.filterSet.every((item) =>
        'filterSet' in item
          ? isFilterComplete(item)
          : Boolean(
              item.fieldId &&
                item.operator &&
                (EMPTY_VALUE_OPERATORS.has(item.operator) || item.value != null)
            )
      )
  );

interface IGridColorRuleDialogProps {
  rules: IGridRowColorRule[];
  onChange: (rules: IGridRowColorRule[]) => void;
}

export const GridColorRuleDialog = ({ rules, onChange }: IGridColorRuleDialogProps) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const [open, setOpen] = useState(false);
  const [draftRules, setDraftRules] = useState<IGridRowColorRule[]>(rules);
  const tableId = useTableId();
  const viewId = useViewId();
  const allFields = useFields({ withHidden: true, withDenied: true });
  const fields = useMemo(
    () => allFields.filter((field) => field.type !== FieldType.Button),
    [allFields]
  );
  const viewFilterLinkContext = useViewFilterLinkContext(tableId, viewId, { disabled: !open });
  const isDirty = !isEqual(draftRules, rules);
  const hasIncompleteEnabledRule = draftRules.some(
    (rule) => rule.enabled !== false && !isFilterComplete(rule.filter)
  );

  const onOpenChange = (nextOpen: boolean) => {
    if (nextOpen) setDraftRules(rules);
    setOpen(nextOpen);
  };

  const updateRule = (ruleId: string, patch: Partial<IGridRowColorRule>) => {
    setDraftRules((current) =>
      current.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule))
    );
  };

  const moveRule = (index: number, offset: number) => {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= draftRules.length) return;
    const nextRules = [...draftRules];
    [nextRules[index], nextRules[targetIndex]] = [nextRules[targetIndex], nextRules[index]];
    setDraftRules(nextRules);
  };

  const addRule = () => {
    if (draftRules.length >= 20) return;
    setDraftRules([
      ...draftRules,
      {
        id: `gcr${getRandomString(12)}`,
        enabled: true,
        color: RULE_COLORS[draftRules.length % RULE_COLORS.length],
        filter: null,
        target: 'row',
      },
    ]);
  };

  const applyRules = () => {
    if (!isDirty || hasIncompleteEnabledRule) return;
    onChange(draftRules);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Button
        variant="outline"
        className="w-full justify-between"
        onClick={() => onOpenChange(true)}
      >
        <span>{t('table:grid.style.manageColorRules')}</span>
        <span className="text-xs text-muted-foreground">{rules.length}/20</span>
      </Button>
      <DialogContent className="flex max-h-[82vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle>{t('table:grid.style.conditionalColoring')}</DialogTitle>
          <DialogDescription>
            {t('table:grid.style.conditionalColoringDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-3 overflow-y-auto bg-muted/30 px-6 py-5">
          {draftRules.map((rule, index) => (
            <div key={rule.id} className="rounded-xl border bg-background shadow-sm">
              <div className="flex items-center gap-2 border-b px-3 py-2">
                <DraggableHandle className="size-4 text-muted-foreground" />
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t('table:grid.style.ruleColor')}
                    >
                      <span
                        className="size-4 rounded-full border"
                        style={{
                          backgroundColor: ColorUtils.getHexForColor(rule.color) ?? rule.color,
                        }}
                      />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-2">
                    <div className="grid grid-cols-5 gap-2">
                      {RULE_COLORS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          className="size-7 rounded-full border-2 border-background ring-offset-2 hover:ring-2 hover:ring-ring"
                          style={{ backgroundColor: ColorUtils.getHexForColor(color) ?? '' }}
                          aria-label={color}
                          onClick={() => updateRule(rule.id, { color })}
                        />
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <span className="flex-1 text-sm font-medium">
                  {t('table:grid.style.ruleName', { number: index + 1 })}
                </span>
                <Switch
                  checked={rule.enabled !== false}
                  onCheckedChange={(enabled) => updateRule(rule.id, { enabled })}
                  aria-label={t('table:grid.style.enableRule')}
                />
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={index === 0}
                  onClick={() => moveRule(index, -1)}
                  aria-label={t('table:grid.style.moveRuleUp')}
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={index === draftRules.length - 1}
                  onClick={() => moveRule(index, 1)}
                  aria-label={t('table:grid.style.moveRuleDown')}
                >
                  <ArrowDown className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setDraftRules(draftRules.filter(({ id }) => id !== rule.id))}
                  aria-label={t('table:grid.style.deleteRule')}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <div className="space-y-2 px-4 py-3">
                <div className="text-xs text-muted-foreground">
                  {t('table:grid.style.whenConditionsMatch')}
                </div>
                <BaseViewFilter
                  modal
                  value={rule.filter as IFilter}
                  fields={fields}
                  onChange={(filter) => updateRule(rule.id, { filter })}
                  viewFilterLinkContext={viewFilterLinkContext}
                />
              </div>
            </div>
          ))}

          {!draftRules.length && (
            <div className="rounded-xl border border-dashed bg-background px-6 py-12 text-center">
              <div className="text-sm font-medium">{t('table:grid.style.noColorRules')}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {t('table:grid.style.noColorRulesDescription')}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t bg-background px-6 py-4">
          <span className="text-xs text-muted-foreground">
            {t('table:grid.style.firstMatchingRuleWins')}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={addRule} disabled={draftRules.length >= 20}>
              <Plus className="me-1.5 size-4" />
              {t('table:grid.style.addColorRule')}
            </Button>
            <Button onClick={applyRules} disabled={!isDirty || hasIncompleteEnabledRule}>
              {t('table:grid.style.applyColorRules')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
