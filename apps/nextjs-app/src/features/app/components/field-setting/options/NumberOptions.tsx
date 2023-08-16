import { Relationship } from '@teable-group/core';
import type {
  CellValueType,
  ILookupOptionsRo,
  INumberShowAs,
  INumberFormatting,
  INumberFieldOptions,
} from '@teable-group/core';
import { useFields } from '@teable-group/sdk/hooks';
import type { LinkField } from '@teable-group/sdk/model';
import { useMemo } from 'react';
import { NumberFormatting } from '../formatting/NumberFormatting';
import { MultiNumberShowAs } from '../show-as/MultiNumberShowAs';
import { SingleNumberShowAs } from '../show-as/SingleNumberShowAs';

export const NumberOptions = (props: {
  options: Partial<INumberFieldOptions> | undefined;
  isLookup?: boolean;
  cellValueType?: CellValueType;
  lookupOptions?: ILookupOptionsRo;
  onChange?: (options: Partial<INumberFieldOptions>) => void;
}) => {
  const { options, lookupOptions, onChange } = props;
  const fields = useFields();

  const isMultipleCellValue = useMemo(() => {
    const { linkFieldId } = lookupOptions || {};
    if (linkFieldId == null) return false;

    const linkField = fields.find((f) => f.id === linkFieldId) as LinkField;

    if (linkField == null) return;

    const relationship = linkField.options.relationship;

    return relationship !== Relationship.ManyOne;
  }, [fields, lookupOptions]);

  const ShowAsComponent = isMultipleCellValue ? MultiNumberShowAs : SingleNumberShowAs;

  const onFormattingChange = (formatting: INumberFormatting) => {
    onChange?.({
      formatting,
    });
  };

  const onShowAsChange = (showAs?: INumberShowAs) => {
    onChange?.({
      showAs,
    });
  };

  return (
    <div className="form-control space-y-2">
      <NumberFormatting formatting={options?.formatting} onChange={onFormattingChange} />
      <ShowAsComponent showAs={options?.showAs as never} onChange={onShowAsChange} />
    </div>
  );
};
