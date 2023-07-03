import type { ILinkFieldOptionsRo } from '@teable-group/core';
import { Relationship } from '@teable-group/core';
import { useTables } from '@teable-group/sdk/hooks';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SelectTable } from '../SelectTable';

const relationshipOptions = [Relationship.ManyOne, Relationship.OneMany, Relationship.ManyMany];

export const LinkOptions = (props: {
  options: ILinkFieldOptionsRo;
  isLookup?: boolean;
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
