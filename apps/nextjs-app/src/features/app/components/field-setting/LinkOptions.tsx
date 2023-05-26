import type { ILinkFieldOptionsRo } from '@teable-group/core';
import { Relationship } from '@teable-group/core';
import { useTables } from '@teable-group/sdk/hooks';
import { Select, SelectItem } from '../common/select';

const relationshipOptions = [Relationship.ManyOne, Relationship.OneMany, Relationship.ManyMany];

export const LinkOptions = (props: {
  options: ILinkFieldOptionsRo;
  onChange?: (options: ILinkFieldOptionsRo) => void;
}) => {
  const { options, onChange } = props;
  const tables = useTables();
  const { foreignTableId, relationship } = options;

  const onForeignTableIdChange = (value: string) => {
    const foreignTableId = value;
    onChange?.({ foreignTableId, relationship });
  };

  const onRelationshipChange = (value: Relationship) => {
    const relationship = value;
    onChange?.({ foreignTableId, relationship });
  };

  return (
    <div className="form-control w-full">
      <div className="label">
        <span className="neutral-content label-text mb-2">Link table</span>
      </div>
      <Select size="small" value={foreignTableId} onValueChange={onForeignTableIdChange}>
        {tables.map((table) => (
          <SelectItem key={table.id} value={table.id}>
            {table.name}
          </SelectItem>
        ))}
      </Select>
      <div className="label">
        <span className="neutral-content label-text mb-2">Relationship</span>
      </div>
      <Select size="small" value={relationship} onValueChange={onRelationshipChange}>
        {relationshipOptions.map((rsp) => (
          <SelectItem key={rsp} value={rsp}>
            {rsp}
          </SelectItem>
        ))}
      </Select>
    </div>
  );
};
