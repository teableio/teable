import { useFieldStaticGetter } from '@teable/sdk/hooks';
import type { IFieldInstance } from '@teable/sdk/model';
import { Button } from '@teable/ui-lib/shadcn';
import { Check } from 'lucide-react';

interface FieldSelectionListProps {
  fields: IFieldInstance[];
  selectedFieldId: string | null;
  viewedFieldIds: Set<string>;
  onSelect: (fieldId: string) => void;
}

export const FieldSelectionList = ({
  fields,
  selectedFieldId,
  viewedFieldIds,
  onSelect,
}: FieldSelectionListProps) => {
  const fieldStaticGetter = useFieldStaticGetter();

  return (
    <ul className="space-y-1">
      {fields.map((field) => {
        const isSelected = field.id === selectedFieldId;
        const isViewed = viewedFieldIds.has(field.id);
        const FieldIcon = fieldStaticGetter(field.type).Icon;

        return (
          <li key={field.id}>
            <Button
              className="w-full justify-start"
              size="sm"
              variant={isSelected ? 'secondary' : 'ghost'}
              onClick={() => onSelect(field.id)}
            >
              <span className="flex size-4 shrink-0 items-center justify-center">
                {isViewed && !isSelected && <Check className="size-3.5 text-muted-foreground/70" />}
                {isSelected && <span className="size-1.5 rounded-full bg-current" />}
              </span>
              {FieldIcon && <FieldIcon className="size-4 shrink-0" />}
              <span className="truncate">{field.name}</span>
            </Button>
          </li>
        );
      })}
    </ul>
  );
};
