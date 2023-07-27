import type { ILinkFieldOptionsRo } from '@teable-group/core';
import { Relationship } from '@teable-group/core';
import { useTables } from '@teable-group/sdk/hooks';
import { Label, Switch } from '@teable-group/ui-lib/shadcn';
import { SelectTable } from '../SelectTable';

export const LinkOptions = (props: {
  options: Partial<ILinkFieldOptionsRo> | undefined;
  isLookup?: boolean;
  onChange?: (options: Partial<ILinkFieldOptionsRo>) => void;
}) => {
  const { options, isLookup, onChange } = props;
  const tables = useTables();

  const relationship = options?.relationship ?? Relationship.ManyOne;
  const foreignTableId = options?.foreignTableId;

  const onForeignTableIdChange = (value: string) => {
    const foreignTableId = value;
    onChange?.({ foreignTableId, relationship });
  };

  const onRelationshipChange = (value: Relationship) => {
    const relationship = value;
    onChange?.({ relationship });
  };

  if (isLookup) {
    return <></>;
  }

  return (
    <div className="space-y-2 w-full">
      <span className="neutral-content label-text">Link table</span>
      <SelectTable value={foreignTableId} onChange={onForeignTableIdChange} tables={tables} />
      <div className="flex items-center space-x-2">
        <Switch
          id="field-options-auto-fill"
          checked={Boolean(relationship === Relationship.OneMany)}
          onCheckedChange={(checked) =>
            onRelationshipChange(checked ? Relationship.OneMany : Relationship.ManyOne)
          }
        />
        <Label htmlFor="field-options-auto-fill" className="font-normal">
          Allow linking to multiple records
        </Label>
      </div>
    </div>
  );
};
