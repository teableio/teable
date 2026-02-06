import { match } from 'ts-pattern';
import { SingleLineTextOptions } from './field-options/SingleLineTextOptions';
import { NumberOptions } from './field-options/NumberOptions';
import { RatingOptions } from './field-options/RatingOptions';
import { SelectOptions } from './field-options/SelectOptions';
import { CheckboxOptions } from './field-options/CheckboxOptions';
import { DateOptions } from './field-options/DateOptions';
import { UserOptions } from './field-options/UserOptions';
import { ButtonOptions } from './field-options/ButtonOptions';
import { FormulaOptions } from './field-options/FormulaOptions';
import { LinkOptions } from './field-options/LinkOptions';
import { RollupOptions } from './field-options/RollupOptions';
import { LookupOptions } from './field-options/LookupOptions';
import { ConditionalRollupOptions } from './field-options/ConditionalRollupOptions';
import { ConditionalLookupOptions } from './field-options/ConditionalLookupOptions';
import type { FieldFormApi } from './FieldForm';
import {
  checkFieldNotNullValidationEnabled,
  checkFieldUniqueValidationEnabled,
  isComputedFieldType,
  type ITableFieldInput,
} from '@teable/v2-core';
import type { ITableDto } from '@teable/v2-contract-http';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface FieldFormOptionsProps {
  type: ITableFieldInput['type'];
  form: FieldFormApi;
  tableId: string;
  tables: ReadonlyArray<ITableDto>;
  isTablesLoading: boolean;
}

export function FieldFormOptions({
  type,
  form,
  tableId,
  tables,
  isTablesLoading,
}: FieldFormOptionsProps) {
  const isComputed = isComputedFieldType(type);
  const notNullEnabled = checkFieldNotNullValidationEnabled(type, { isComputed });
  const uniqueEnabled = checkFieldUniqueValidationEnabled(type, { isComputed });
  const validationHint = isComputed
    ? 'Computed fields do not support not-null or unique validation.'
    : 'No validation options for this field type.';

  return (
    <div className="space-y-4 border-t pt-4">
      <h3 className="text-sm font-medium">Field Options</h3>
      {match(type)
        .with('singleLineText', () => <SingleLineTextOptions form={form} />)
        .with('longText', () => (
          <p className="text-xs text-muted-foreground">No options for long text.</p>
        ))
        .with('number', () => <NumberOptions form={form} />)
        .with('rating', () => <RatingOptions form={form} />)
        .with('singleSelect', () => <SelectOptions form={form} />)
        .with('multipleSelect', () => <SelectOptions form={form} />)
        .with('checkbox', () => <CheckboxOptions form={form} />)
        .with('attachment', () => (
          <p className="text-xs text-muted-foreground">No options for attachment.</p>
        ))
        .with('date', () => <DateOptions form={form} />)
        .with('createdTime', () => (
          <p className="text-xs text-muted-foreground">No options for created time.</p>
        ))
        .with('lastModifiedTime', () => (
          <p className="text-xs text-muted-foreground">No options for last modified time.</p>
        ))
        .with('user', () => <UserOptions form={form} />)
        .with('createdBy', () => (
          <p className="text-xs text-muted-foreground">No options for created by.</p>
        ))
        .with('lastModifiedBy', () => (
          <p className="text-xs text-muted-foreground">No options for last modified by.</p>
        ))
        .with('autoNumber', () => (
          <p className="text-xs text-muted-foreground">No options for auto number.</p>
        ))
        .with('button', () => <ButtonOptions form={form} />)
        .with('formula', () => <FormulaOptions form={form} />)
        .with('link', () => (
          <LinkOptions
            form={form}
            tableId={tableId}
            tables={tables}
            isTablesLoading={isTablesLoading}
          />
        ))
        .with('rollup', () => (
          <RollupOptions
            form={form}
            tableId={tableId}
            tables={tables}
            isTablesLoading={isTablesLoading}
          />
        ))
        .with('lookup', () => (
          <LookupOptions
            form={form}
            tableId={tableId}
            tables={tables}
            isTablesLoading={isTablesLoading}
          />
        ))
        .with('conditionalRollup', () => (
          <ConditionalRollupOptions
            form={form}
            tableId={tableId}
            tables={tables}
            isTablesLoading={isTablesLoading}
          />
        ))
        .with('conditionalLookup', () => (
          <ConditionalLookupOptions
            form={form}
            tableId={tableId}
            tables={tables}
            isTablesLoading={isTablesLoading}
          />
        ))
        .exhaustive()}
      <div className="space-y-2 pt-2">
        <h4 className="text-xs font-medium uppercase text-muted-foreground">Validation</h4>
        {notNullEnabled || uniqueEnabled ? (
          <div className="space-y-2">
            {notNullEnabled ? (
              <form.Field
                name="notNull"
                children={(field) => (
                  <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-3">
                    <div className="space-y-0.5">
                      <Label htmlFor={field.name}>Not Null</Label>
                      <p className="text-xs text-muted-foreground">
                        Require a value in every record.
                      </p>
                    </div>
                    <Switch
                      id={field.name}
                      checked={field.state.value === true}
                      onCheckedChange={(checked) =>
                        field.handleChange(checked ? true : (undefined as any))
                      }
                    />
                  </div>
                )}
              />
            ) : null}
            {uniqueEnabled ? (
              <form.Field
                name="unique"
                children={(field) => (
                  <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-3">
                    <div className="space-y-0.5">
                      <Label htmlFor={field.name}>Unique</Label>
                      <p className="text-xs text-muted-foreground">
                        Prevent duplicate values across records.
                      </p>
                    </div>
                    <Switch
                      id={field.name}
                      checked={field.state.value === true}
                      onCheckedChange={(checked) =>
                        field.handleChange(checked ? true : (undefined as any))
                      }
                    />
                  </div>
                )}
              />
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{validationHint}</p>
        )}
      </div>
    </div>
  );
}
