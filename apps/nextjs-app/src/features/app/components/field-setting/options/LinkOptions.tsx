import type { ILinkFieldOptionsRo } from '@teable-group/core';
import { Relationship } from '@teable-group/core';
import { useTables } from '@teable-group/sdk/hooks';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@teable-group/ui-lib/shadcn/ui/select';
import { SelectTable } from '../SelectTable';

const relationshipOptions = [Relationship.ManyOne, Relationship.OneMany, Relationship.ManyMany];

export const LinkOptions = (props: {
  options: Partial<ILinkFieldOptionsRo> | undefined;
  isLookup?: boolean;
  onChange?: (options: Partial<ILinkFieldOptionsRo>) => void;
}) => {
  const { options, isLookup, onChange } = props;
  const tables = useTables();

  const relationship = options?.relationship;
  const foreignTableId = options?.foreignTableId;

  const onForeignTableIdChange = (value: string) => {
    const foreignTableId = value;
    onChange?.({ foreignTableId });
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
      <div className="space-y-2">
        <span className="neutral-content label-text">Link table</span>
        <SelectTable value={foreignTableId} onChange={onForeignTableIdChange} tables={tables} />
      </div>

      <div className="space-y-2">
        <span className="neutral-content label-text">Relationship</span>
        <Select value={relationship} onValueChange={onRelationshipChange}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {relationshipOptions.map((rsp) => (
              <SelectItem key={rsp} value={rsp}>
                {rsp}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};
