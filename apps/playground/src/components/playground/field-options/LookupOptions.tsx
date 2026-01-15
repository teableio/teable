import { useMemo } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { LinkFieldLabel } from '@/components/playground/LinkFieldLabel';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ITableDto } from '@teable/v2-contract-http';
import type { FieldFormApi } from '../FieldForm';

type LinkFieldDto = Extract<ITableDto['fields'][number], { type: 'link' }>;

type LookupOptionsProps = {
  form: FieldFormApi;
  tableId: string;
  tables: ReadonlyArray<ITableDto>;
  isTablesLoading: boolean;
};

export function LookupOptions({ form, tableId, tables, isTablesLoading }: LookupOptionsProps) {
  const currentTable = useMemo(
    () => tables.find((table) => table.id === tableId),
    [tables, tableId]
  );
  const linkFields = useMemo(
    () => (currentTable?.fields.filter((field) => field.type === 'link') ?? []) as LinkFieldDto[],
    [currentTable]
  );
  const hasLinkFields = linkFields.length > 0;

  return (
    <div className="space-y-4">
      {!hasLinkFields ? (
        <p className="text-xs text-muted-foreground">
          No link fields available. Create a link field first to use lookup.
        </p>
      ) : null}

      <form.Field
        name="options.linkFieldId"
        children={(field) => {
          const selectedLinkId = field.state.value as string | undefined;
          const selectedLinkField = linkFields.find((entry) => entry.id === selectedLinkId) ?? null;
          const foreignTableId = selectedLinkField?.options?.foreignTableId;
          const foreignTable = tables.find((table) => table.id === foreignTableId) ?? null;
          const foreignFields = foreignTable?.fields ?? [];

          return (
            <div className="space-y-2">
              <Label htmlFor={field.name}>Link Field</Label>
              <Select
                value={selectedLinkId ?? ''}
                onValueChange={(value) => {
                  const nextLink = linkFields.find((entry) => entry.id === value) ?? null;
                  const nextForeignTableId = nextLink?.options?.foreignTableId;
                  const nextForeignTable =
                    tables.find((table) => table.id === nextForeignTableId) ?? null;
                  const nextLookupField =
                    nextForeignTable?.fields.find((entry) => entry.isPrimary) ??
                    nextForeignTable?.fields[0] ??
                    null;

                  field.handleChange((value || undefined) as any);
                  form.setFieldValue('options.foreignTableId', (nextForeignTableId ?? '') as any);
                  form.setFieldValue('options.lookupFieldId', (nextLookupField?.id ?? '') as any);
                }}
                disabled={!hasLinkFields || isTablesLoading}
              >
                <SelectTrigger id={field.name}>
                  <SelectValue placeholder={isTablesLoading ? 'Loading...' : 'Select link field'} />
                </SelectTrigger>
                <SelectContent>
                  {linkFields.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      <LinkFieldLabel
                        name={entry.name}
                        fieldId={entry.id}
                        relationship={entry.options?.relationship ?? 'manyMany'}
                        isOneWay={entry.options?.isOneWay ?? false}
                      />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {field.state.meta.errors ? (
                <p className="text-xs text-destructive">{field.state.meta.errors.join(', ')}</p>
              ) : null}

              <form.Field
                name="options.foreignTableId"
                children={(foreignField) => (
                  <div className="space-y-2 pt-2">
                    <Label htmlFor={foreignField.name}>Foreign Table</Label>
                    <Input id={foreignField.name} value={foreignTable?.name ?? '-'} readOnly />
                    {foreignField.state.meta.errors ? (
                      <p className="text-xs text-destructive">
                        {foreignField.state.meta.errors.join(', ')}
                      </p>
                    ) : null}
                  </div>
                )}
              />

              <form.Field
                name="options.lookupFieldId"
                children={(lookupFieldState) => (
                  <div className="space-y-2 pt-2">
                    <Label htmlFor={lookupFieldState.name}>Lookup Field</Label>
                    <Select
                      value={(lookupFieldState.state.value as string | undefined) ?? ''}
                      onValueChange={(value) => lookupFieldState.handleChange(value as any)}
                      disabled={!foreignFields.length}
                    >
                      <SelectTrigger id={lookupFieldState.name}>
                        <SelectValue placeholder="Select lookup field" />
                      </SelectTrigger>
                      <SelectContent>
                        {foreignFields.map((entry) => (
                          <SelectItem key={entry.id} value={entry.id}>
                            {entry.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
