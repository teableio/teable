import type { LinkRelationshipValue } from '@teable/v2-core';
import { Badge } from '@/components/ui/badge';
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
