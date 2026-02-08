import { useMemo } from 'react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ITableDto } from '@teable/v2-contract-http';
import type { FieldFormApi } from '../FieldForm';
import { ConditionBuilder, type ConditionValue } from './ConditionBuilder';

type ConditionalLookupOptionsProps = {
  form: FieldFormApi;
  tableId: string;
  tables: ReadonlyArray<ITableDto>;
  isTablesLoading: boolean;
};

export function ConditionalLookupOptions({
  form,
  tableId,
  tables,
  isTablesLoading,
}: ConditionalLookupOptionsProps) {
  // Cast form to any to work around strict typing for nested paths
  const formAny = form as any;
  // Get all tables except current for foreign table selection
  const foreignTables = useMemo(
    () => tables.filter((table) => table.id !== tableId),
    [tables, tableId]
  );

  return (
    <div className="space-y-4">
      {foreignTables.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No other tables available. Create another table first.
        </p>
      ) : null}

      {/* Foreign Table Selection */}
      <form.Field
        name="options.foreignTableId"
        children={(field) => {
          const selectedTableId = field.state.value as string | undefined;
          const foreignTable = tables.find((t) => t.id === selectedTableId);
          const foreignFields = foreignTable?.fields ?? [];

          return (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor={field.name}>Foreign Table</Label>
                <Select
                  value={selectedTableId ?? ''}
                  onValueChange={(value) => {
                    const nextTable = tables.find((t) => t.id === value);
                    const nextLookupField =
                      nextTable?.fields.find((f) => f.isPrimary) ?? nextTable?.fields[0];

                    field.handleChange(value as any);
                    formAny.setFieldValue(
                      'options.lookupFieldId',
                      (nextLookupField?.id ?? '') as any
                    );
                    // Reset condition when table changes
                    formAny.setFieldValue('options.condition', { filter: null } as any);
                  }}
                  disabled={foreignTables.length === 0 || isTablesLoading}
                >
                  <SelectTrigger id={field.name}>
                    <SelectValue
                      placeholder={isTablesLoading ? 'Loading...' : 'Select foreign table'}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {foreignTables.map((table) => (
                      <SelectItem key={table.id} value={table.id}>
                        {table.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {field.state.meta.errors ? (
                  <p className="text-xs text-destructive">{field.state.meta.errors.join(', ')}</p>
                ) : null}
              </div>

              {/* Lookup Field Selection */}
              <form.Field
                name="options.lookupFieldId"
                children={(lookupField) => (
                  <div className="space-y-2">
                    <Label htmlFor={lookupField.name}>Lookup Field</Label>
                    <Select
                      value={(lookupField.state.value as string | undefined) ?? ''}
                      onValueChange={(value) => lookupField.handleChange(value as any)}
                      disabled={!foreignFields.length}
                    >
                      <SelectTrigger id={lookupField.name}>
                        <SelectValue placeholder="Select lookup field" />
                      </SelectTrigger>
                      <SelectContent>
                        {foreignFields.map((f) => (
                          <SelectItem key={f.id} value={f.id}>
                            {f.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {lookupField.state.meta.errors ? (
                      <p className="text-xs text-destructive">
                        {lookupField.state.meta.errors.join(', ')}
                      </p>
                    ) : null}
                  </div>
                )}
              />

              {/* Condition Builder */}
              {selectedTableId && foreignFields.length > 0 && (
                <form.Field
                  name="options.condition"
                  children={(conditionField) => (
                    <div className="space-y-2">
                      <Label>Condition (filter records from foreign table)</Label>
                      <ConditionBuilder
                        value={(conditionField.state.value as ConditionValue) ?? { filter: null }}
                        onChange={(value) => conditionField.handleChange(value as any)}
                        fields={foreignFields}
                        showSort={true}
                        showLimit={true}
                      />
                    </div>
                  )}
                />
              )}
            </div>
          );
        }}
      />
    </div>
  );
}
