import type { Field, LinkField, LinkRelationshipValue } from '@teable/v2-core';
import { Badge } from '@/components/ui/badge';
import { getFieldTypeIcon } from '@/lib/fieldTypeIcons';
import { cn } from '@/lib/utils';

type LinkFieldLabelProps = {
  name: string;
  fieldId: string;
  relationship: string;
  isOneWay?: boolean;
  className?: string;
  badgeClassName?: string;
};

const relationshipLabels: Record<LinkRelationshipValue, string> = {
  manyMany: 'many-many',
  oneMany: 'one-many',
  manyOne: 'many-one',
  oneOne: 'one-one',
};

const formatRelationshipLabel = (relationship: string): string =>
  relationshipLabels[relationship as LinkRelationshipValue] ?? relationship;

export function LinkFieldLabel({
  name,
  fieldId,
  relationship,
  isOneWay = false,
  className,
  badgeClassName,
}: LinkFieldLabelProps) {
  const relationshipLabel = formatRelationshipLabel(relationship);
  const directionLabel = isOneWay ? 'one-way' : 'two-way';
  const badgeClasses = cn('h-4 px-1 text-[9px] font-normal uppercase', badgeClassName);

  return (
    <span
      className={cn('inline-flex items-center gap-1.5', className)}
      data-field-id={fieldId}
      title={fieldId}
    >
      <span>{name}</span>
      <Badge variant="outline" className={badgeClasses}>
        {relationshipLabel}
      </Badge>
      <Badge variant={isOneWay ? 'secondary' : 'outline'} className={badgeClasses}>
        {directionLabel}
      </Badge>
    </span>
  );
}

type FieldLabelProps = {
  field: Field;
  className?: string;
};

export function FieldLabel({ field, className }: FieldLabelProps) {
  const fieldId = field.id().toString();
  const fieldType = field.type().toString();
  const fieldName = field.name().toString();
  const FieldIcon = getFieldTypeIcon(fieldType);

  if (fieldType === 'link') {
    const linkField = field as LinkField;
    return (
      <span className={cn('inline-flex min-w-0 items-center gap-2', className)} title={fieldId}>
        <FieldIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <LinkFieldLabel
          name={fieldName}
          fieldId={fieldId}
          relationship={linkField.relationship().toString()}
          isOneWay={linkField.isOneWay()}
          className="min-w-0"
        />
      </span>
    );
  }

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)} title={fieldId}>
      <FieldIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{fieldName}</span>
    </span>
  );
}
