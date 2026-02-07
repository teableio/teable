import { useMemo, useState } from 'react';
import type { ITableDto } from '@teable/v2-contract-http';
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
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
  const [isOpen, setIsOpen] = useState(false);

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
              <Popover open={isOpen} onOpenChange={setIsOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id={field.name}
                    variant="outline"
                    role="combobox"
                    aria-expanded={isOpen}
                    className="w-full justify-between"
                    disabled={isTablesLoading}
                  >
                    {selectedTable?.name ??
                      (isTablesLoading ? 'Loading tables...' : 'Select a table to link')}
                    <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-60" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search tables..." />
                    <CommandList>
                      <CommandEmpty>
                        {availableTables.length ? 'No matching tables.' : 'No other tables.'}
                      </CommandEmpty>
                      <CommandGroup>
                        {availableTables.map((table) => (
                          <CommandItem
                            key={table.id}
                            value={table.id}
                            keywords={[table.name]}
                            onSelect={() => {
                              const nextTable =
                                availableTables.find((entry) => entry.id === table.id) ?? null;
                              const nextLookup =
                                nextTable?.fields.find((entry) => entry.isPrimary) ??
                                nextTable?.fields[0] ??
                                null;
                              field.handleChange(table.id as any);
                              form.setFieldValue(
                                'options.lookupFieldId',
                                (nextLookup?.id ?? undefined) as any
                              );
                              setIsOpen(false);
                            }}
                          >
                            <CheckIcon
                              className={cn(
                                'mr-2 size-4',
                                table.id === selectedTableId ? 'opacity-100' : 'opacity-0'
                              )}
                            />
                            {table.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
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
