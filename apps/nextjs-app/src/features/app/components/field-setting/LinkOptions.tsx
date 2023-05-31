import type { ILinkFieldOptionsRo } from '@teable-group/core';
import { Relationship } from '@teable-group/core';
import { useTables } from '@teable-group/sdk/hooks';
import { Select } from 'antd';
const { Option } = Select;

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
      <Select value={foreignTableId} onChange={onForeignTableIdChange}>
        {tables.map((table) => (
          <Option key={table.id} value={table.id}>
            {table.name}
          </Option>
        ))}
      </Select>
      <div className="label">
        <span className="neutral-content label-text mb-2">Relationship</span>
      </div>
      <Select value={relationship} onChange={onRelationshipChange}>
        {relationshipOptions.map((rsp) => (
          <Option key={rsp} value={rsp}>
            {rsp}
          </Option>
        ))}
      </Select>
    </div>
  );
};
