import { useMemo } from 'react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ROLLUP_FUNCTIONS, TIME_ZONE_LIST } from '@teable/v2-core';
import type { ITableDto } from '@teable/v2-contract-http';
import type { FieldFormApi } from '../FieldForm';
import { ConditionBuilder, type ConditionValue } from './ConditionBuilder';

type ConditionalRollupOptionsProps = {
  form: FieldFormApi;
  tableId: string;
  tables: ReadonlyArray<ITableDto>;
  isTablesLoading: boolean;
};

export function ConditionalRollupOptions({
  form,
  tableId,
  tables,
  isTablesLoading,
}: ConditionalRollupOptionsProps) {
  // Cast form to any to work around strict typing for config paths
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
      <formAny.Field
        name="config.foreignTableId"
        children={(field: any) => {
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

                    field.handleChange(value);
                    formAny.setFieldValue('config.lookupFieldId', nextLookupField?.id ?? '');
                    // Reset condition when table changes (condition is in config for conditionalRollup)
                    formAny.setFieldValue('config.condition', { filter: null });
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
              <formAny.Field
                name="config.lookupFieldId"
                children={(lookupField: any) => (
                  <div className="space-y-2">
                    <Label htmlFor={lookupField.name}>Lookup Field (for aggregation)</Label>
                    <Select
                      value={(lookupField.state.value as string | undefined) ?? ''}
                      onValueChange={(value) => lookupField.handleChange(value)}
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
                <formAny.Field
                  name="config.condition"
                  children={(conditionField: any) => (
                    <div className="space-y-2">
                      <Label>Condition (filter records from foreign table)</Label>
                      <ConditionBuilder
                        value={(conditionField.state.value as ConditionValue) ?? { filter: null }}
                        onChange={(value) => conditionField.handleChange(value)}
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

      {/* Rollup Function */}
      <form.Field
        name="options.expression"
        children={(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Rollup Function</Label>
            <Select
              value={(field.state.value as string | undefined) ?? ''}
              onValueChange={(value) => field.handleChange(value as any)}
            >
              <SelectTrigger id={field.name}>
                <SelectValue placeholder="Select rollup function" />
              </SelectTrigger>
              <SelectContent>
                {ROLLUP_FUNCTIONS.map((expr) => (
                  <SelectItem key={expr} value={expr}>
                    {expr}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {field.state.meta.errors ? (
              <p className="text-xs text-destructive">{field.state.meta.errors.join(', ')}</p>
            ) : null}
          </div>
        )}
      />

      {/* Time Zone */}
      <form.Field
        name="options.timeZone"
        children={(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Time Zone</Label>
            <Select
              value={(field.state.value as string | undefined) ?? TIME_ZONE_LIST[0]}
              onValueChange={(value) => field.handleChange(value as any)}
            >
              <SelectTrigger id={field.name}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {TIME_ZONE_LIST.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {field.state.meta.errors ? (
              <p className="text-xs text-destructive">{field.state.meta.errors.join(', ')}</p>
            ) : null}
          </div>
        )}
      />
    </div>
  );
}
