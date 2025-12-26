import { useMemo } from 'react';
import type { ITableDto } from '@teable/v2-contract-http';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FieldFormApi } from '../FieldForm';

const relationshipOptions = [
  { value: 'manyMany', label: 'Many to many' },
  { value: 'oneMany', label: 'One to many' },
  { value: 'manyOne', label: 'Many to one' },
  { value: 'oneOne', label: 'One to one' },
] as const;

type LinkOptionsProps = {
  form: FieldFormApi;
  tableId: string;
  tables: ReadonlyArray<ITableDto>;
  isTablesLoading: boolean;
};

export function LinkOptions({ form, tableId, tables, isTablesLoading }: LinkOptionsProps) {
  const availableTables = useMemo(
    () => tables.filter((table) => table.id !== tableId),
    [tables, tableId]
  );

  return (
    <div className="space-y-4">
      <form.Field
        name="options.relationship"
        children={(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Relationship</Label>
            <Select
              value={(field.state.value as string | undefined) ?? 'manyMany'}
              onValueChange={(value) => field.handleChange(value as any)}
            >
              <SelectTrigger id={field.name}>
                <SelectValue placeholder="Select relationship" />
              </SelectTrigger>
              <SelectContent>
                {relationshipOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
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

      <form.Field
        name="options.foreignTableId"
        children={(field) => {
          const selectedTableId = field.state.value as string | undefined;
          const selectedTable =
            availableTables.find((table) => table.id === selectedTableId) ?? null;
          const lookupField =
            selectedTable?.fields.find((value) => value.isPrimary) ??
            selectedTable?.fields[0] ??
            null;

          return (
            <div className="space-y-2">
              <Label htmlFor={field.name}>Linked Table</Label>
              <Select
                value={selectedTableId}
                onValueChange={(value) => {
                  const nextTable = availableTables.find((table) => table.id === value) ?? null;
                  const nextLookup =
                    nextTable?.fields.find((entry) => entry.isPrimary) ??
                    nextTable?.fields[0] ??
                    null;
                  field.handleChange(value as any);
                  form.setFieldValue('options.lookupFieldId', (nextLookup?.id ?? undefined) as any);
                }}
              >
                <SelectTrigger id={field.name}>
                  <SelectValue
                    placeholder={isTablesLoading ? 'Loading tables...' : 'Select a table to link'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {availableTables.length === 0 ? (
                    <SelectItem value="__empty__" disabled>
                      No other tables available
                    </SelectItem>
                  ) : (
                    availableTables.map((table) => (
                      <SelectItem key={table.id} value={table.id}>
                        {table.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {field.state.meta.errors ? (
                <p className="text-xs text-destructive">{field.state.meta.errors.join(', ')}</p>
              ) : null}

              <form.Field
                name="options.lookupFieldId"
                children={(lookupFieldState) => (
                  <div className="space-y-2 pt-2">
                    <Label htmlFor={lookupFieldState.name}>Lookup Field</Label>
                    <Input id={lookupFieldState.name} value={lookupField?.name ?? '-'} readOnly />
                    {lookupFieldState.state.meta.errors ? (
                      <p className="text-xs text-destructive">
                        {lookupFieldState.state.meta.errors.join(', ')}
                      </p>
                    ) : null}
                  </div>
                )}
              />
            </div>
          );
        }}
      />
    </div>
  );
}
