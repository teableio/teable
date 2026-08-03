import { useFieldStaticGetter } from '@teable/sdk/hooks';
import type { IFieldInstance } from '@teable/sdk/model';
import { Checkbox, cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import type { AffectedItem } from './types';

interface FieldSelectionListProps {
  fields: IFieldInstance[];
  selectedFieldId: string | null;
  checkedFieldIds: Set<string>;
  fieldRiskMap: Map<string, AffectedItem[]>;
  onSelect: (fieldId: string) => void;
  onToggleCheck: (fieldId: string) => void;
}

export const FieldSelectionList = ({
  fields,
  selectedFieldId,
  checkedFieldIds,
  fieldRiskMap,
  onSelect,
  onToggleCheck,
}: FieldSelectionListProps) => {
  const { t } = useTranslation(['table']);
  const fieldStaticGetter = useFieldStaticGetter();

  const { riskFields, safeFields } = useMemo(() => {
    const risk: IFieldInstance[] = [];
    const safe: IFieldInstance[] = [];
    fields.forEach((field) => {
      const affected = fieldRiskMap.get(field.id) ?? [];
      if (affected.length > 0) {
        risk.push(field);
      } else {
        safe.push(field);
      }
    });
    return { riskFields: risk, safeFields: safe };
  }, [fields, fieldRiskMap]);

  const renderFieldItem = (field: IFieldInstance) => {
    const isSelected = field.id === selectedFieldId;
    const isChecked = checkedFieldIds.has(field.id);
    const FieldIcon = fieldStaticGetter(field.type).Icon;

    return (
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
      <li
        key={field.id}
        className={cn(
          'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
          isSelected ? 'bg-accent text-foreground font-medium' : 'hover:bg-accent'
        )}
        onClick={() => onSelect(field.id)}
      >
        <Checkbox
          checked={isChecked}
          onCheckedChange={() => onToggleCheck(field.id)}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0"
        />
        {FieldIcon && <FieldIcon className="size-4 shrink-0" />}
        <span className="truncate">{field.name}</span>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {riskFields.length > 0 && (
        <div>
          <p className="mb-1.5 pl-2 text-xs font-medium text-muted-foreground">
            {t('table:field.editor.deleteField.riskIdentified', { count: riskFields.length })}
          </p>
          <ul className="space-y-0.5">{riskFields.map(renderFieldItem)}</ul>
        </div>
      )}
      {safeFields.length > 0 && (
        <div>
          <p className="mb-1.5 pl-2 text-xs font-medium text-muted-foreground">
            {t('table:field.editor.deleteField.noDependencies', { count: safeFields.length })}
          </p>
          <ul className="space-y-0.5">{safeFields.map(renderFieldItem)}</ul>
        </div>
      )}
    </div>
  );
};
