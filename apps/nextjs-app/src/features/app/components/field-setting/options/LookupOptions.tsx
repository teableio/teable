import type { ILookupOptionsRo } from '@teable-group/core';
import { FieldType } from '@teable-group/core';
import { AnchorProvider } from '@teable-group/sdk/context';
import { useFields, useTable, useFieldStaticGetter } from '@teable-group/sdk/hooks';
import type { IFieldInstance, LinkField } from '@teable-group/sdk/model';
import { useMemo } from 'react';
import { Selector } from '../Selector';

const SelectFieldByTableId: React.FC<{
  selectedId?: string;
  onChange: (lookupField: IFieldInstance) => void;
}> = ({ selectedId, onChange }) => {
  const fields = useFields();
  const table = useTable();
  const getFieldStatic = useFieldStaticGetter();
  return (
    <div className="space-y-2">
      <span className="neutral-content label-text mb-2">
        {table?.name} field you want to look up
      </span>
      <Selector
        placeholder="Select a field..."
        selectedId={selectedId}
        onChange={(id) => {
          onChange(fields.find((f) => f.id === id) as IFieldInstance);
        }}
        candidates={fields.map((f) => {
          const Icon = getFieldStatic(f.type, f.isLookup).Icon;
          return {
            id: f.id,
            name: f.name,
            icon: <Icon />,
          };
        })}
      />
    </div>
  );
};

export const LookupOptions = (props: {
  options: Partial<ILookupOptionsRo> | undefined;
  onChange?: (options: Partial<ILookupOptionsRo> & { lookupField?: IFieldInstance }) => void;
}) => {
  const { options = {}, onChange } = props;
  const fields = useFields();
  const linkFields = useMemo(
    () => fields.filter((f) => f.type === FieldType.Link && !f.isLookup) as LinkField[],
    [fields]
  );
  const existLinkField = linkFields.length > 0;

  return (
    <div className="space-y-2 w-full">
      {existLinkField ? (
        <>
          <div className="space-y-2">
            <span className="neutral-content label-text">
              Linked record field to use for lookup
            </span>
            <Selector
              placeholder="Select a table..."
              selectedId={options.linkFieldId}
              onChange={(selected: string) => {
                const selectedLinkField = linkFields.find((l) => l.id === selected);
                onChange?.({
                  linkFieldId: selected,
                  foreignTableId: selectedLinkField?.options.foreignTableId,
                });
              }}
              candidates={linkFields}
            />
          </div>
          {options.foreignTableId && (
            <AnchorProvider tableId={options.foreignTableId}>
              <SelectFieldByTableId
                selectedId={options.lookupFieldId}
                onChange={(lookupField: IFieldInstance) =>
                  onChange?.({ lookupFieldId: lookupField.id, lookupField })
                }
              />
            </AnchorProvider>
          )}
        </>
      ) : (
        <div className="space-y-2">
          <span className="neutral-content label-text mb-2">
            No linked records to look up. Add a Link to another record field, then try to configure
            your lookup again.
          </span>
        </div>
      )}
    </div>
  );
};
