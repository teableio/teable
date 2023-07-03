import type { ILookupOptions } from '@teable-group/core';
import { FieldType } from '@teable-group/core';
import { AnchorProvider } from '@teable-group/sdk/context';
import { useFields, useTable } from '@teable-group/sdk/hooks';
import type { LinkField } from '@teable-group/sdk/model';
import { useCallback, useMemo, useState } from 'react';
import { Selector } from '../Selector';

const SelectFieldByTableId: React.FC<{
  selectedId?: string;
  onChange: (id: string, type: FieldType) => void;
}> = ({ selectedId, onChange }) => {
  const fields = useFields();
  const table = useTable();

  return (
    <div className="space-y-2">
      <span className="neutral-content label-text mb-2">
        {table?.name} field you want to look up
      </span>
      <Selector
        selectedId={selectedId}
        onChange={(id) => {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          onChange(id, fields.find((f) => f.id === id)!.type);
        }}
        candidates={fields}
      />
    </div>
  );
};

export const LookupOptions = (props: {
  options: ILookupOptions | undefined;
  onChange?: (options: ILookupOptions, fieldType: FieldType) => void;
}) => {
  const { options, onChange } = props;
  const fields = useFields();
  const linkFields = useMemo(
    () => fields.filter((f) => f.type === FieldType.Link && !f.isLookup) as LinkField[],
    [fields]
  );
  const [localLookupOptions, privateSetLocalLookupOptions] = useState<
    Partial<ILookupOptions & { fieldType: FieldType }>
  >(options || {});
  const setLocalLookupOptions = useCallback(
    (props: typeof localLookupOptions) => {
      const fullOptions = {
        ...localLookupOptions,
        ...props,
      };

      privateSetLocalLookupOptions(fullOptions);

      // TODO: validate
      if (
        Object.keys(fullOptions).filter((key) => (fullOptions as Record<string, unknown>)[key])
          .length === 5
      ) {
        onChange?.(fullOptions as ILookupOptions, fullOptions.fieldType as FieldType);
      }
    },
    [localLookupOptions, onChange]
  );
  const existLinkField = linkFields.length > 0;

  return (
    <div className="space-y-2 w-full">
      {existLinkField ? (
        <>
          <div className="space-y-2">
            <span className="neutral-content label-text mb-2">
              Linked record field to use for lookup
            </span>
            <Selector
              selectedId={localLookupOptions.linkFieldId}
              onChange={(selected: string) => {
                const selectedLinkField = linkFields.find((l) => l.id === selected);
                setLocalLookupOptions({
                  linkFieldId: selected,
                  foreignTableId: selectedLinkField?.options.foreignTableId,
                  relationship: selectedLinkField?.options.relationship,
                });
              }}
              candidates={linkFields}
            />
          </div>
          {localLookupOptions.foreignTableId && (
            <AnchorProvider tableId={localLookupOptions.foreignTableId}>
              <SelectFieldByTableId
                selectedId={localLookupOptions.lookupFieldId}
                onChange={(fieldId: string, fieldType: FieldType) =>
                  setLocalLookupOptions({ lookupFieldId: fieldId, fieldType })
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
