import type { ILinkFieldOptionsRo } from '@teable-group/core';
import { Relationship } from '@teable-group/core';
import { useTableId, useTables } from '@teable-group/sdk/hooks';
import { Selector } from '@teable-group/ui-lib/base';
import { Label, Switch } from '@teable-group/ui-lib/shadcn';

export const LinkOptions = (props: {
  options: Partial<ILinkFieldOptionsRo> | undefined;
  isLookup?: boolean;
  onChange?: (options: Partial<ILinkFieldOptionsRo>) => void;
}) => {
  const { options, isLookup, onChange } = props;
  const tableId = useTableId();
  const tables = useTables();

  const relationship = options?.relationship ?? Relationship.ManyOne;
  const foreignTableId = options?.foreignTableId;
  const isOneWay = options?.isOneWay;

  const translation = {
    [Relationship.OneOne]: 'one-to-one',
    [Relationship.OneMany]: 'one-to-many',
    [Relationship.ManyOne]: 'many-to-one',
    [Relationship.ManyMany]: 'many-to-many',
  };

  const onSelect = (key: keyof ILinkFieldOptionsRo, value: unknown) => {
    onChange?.({ foreignTableId, relationship, isOneWay, [key]: value });
  };

  const onRelationshipChange = (leftMulti: boolean, rightMulti: boolean) => {
    if (leftMulti && rightMulti) {
      onSelect('relationship', Relationship.ManyMany);
    }
    if (leftMulti && !rightMulti) {
      onSelect('relationship', Relationship.OneMany);
    }
    if (!leftMulti && rightMulti) {
      onSelect('relationship', Relationship.ManyOne);
    }
    if (!leftMulti && !rightMulti) {
      onSelect('relationship', Relationship.OneOne);
    }
  };

  const isLeftMulti = (relationship: Relationship) => {
    return relationship === Relationship.ManyMany || relationship === Relationship.OneMany;
  };
  const isRightMulti = (relationship: Relationship) => {
    return relationship === Relationship.ManyMany || relationship === Relationship.ManyOne;
  };

  if (isLookup) {
    return <></>;
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <span className="neutral-content label-text">Link table</span>
      <Selector
        selectedId={foreignTableId}
        onChange={(foreignTableId) => onSelect('foreignTableId', foreignTableId)}
        candidates={tables.map((table) => ({
          id: table.id,
          name: table.name + (tableId === table.id ? ' (Self)' : ''),
        }))}
        placeholder="Select table..."
      />
      {foreignTableId && (
        <>
          <hr className="my-2" />
          <div className="flex space-x-2 pt-1">
            <Switch
              id="field-options-one-way-link"
              checked={!isOneWay}
              onCheckedChange={(checked) => {
                onSelect('isOneWay', checked ? undefined : true);
              }}
            />
            <Label htmlFor="field-options-one-way-link" className="font-normal leading-tight">
              Create a symmetric link field in the link table
            </Label>
          </div>
          <div className="flex space-x-2 pt-1">
            <Switch
              id="field-options-self-multi"
              checked={isLeftMulti(relationship)}
              onCheckedChange={(checked) => {
                onRelationshipChange(checked, isRightMulti(relationship));
              }}
            />
            <Label htmlFor="field-options-self-multi" className="font-normal leading-tight">
              Allow linking to multiple records
            </Label>
          </div>
          <div className="flex space-x-2 pt-1">
            <Switch
              id="field-options-sym-multi"
              checked={isRightMulti(relationship)}
              onCheckedChange={(checked) => {
                onRelationshipChange(isLeftMulti(relationship), checked);
              }}
            />
            <Label htmlFor="field-options-sym-multi" className="font-normal leading-tight">
              {isOneWay
                ? 'Allow linking to duplicate records'
                : 'Allow symmetric field linking to multiple records'}
            </Label>
          </div>
          <p className="pt-2">
            Tips: this configuration represents a <br></br>
            <b>{translation[relationship]}</b> relationship{' '}
            {tableId === foreignTableId ? 'in self-link' : 'between two tables'}
          </p>
        </>
      )}
    </div>
  );
};
