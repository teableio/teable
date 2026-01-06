import {
  useForm,
  type ReactFormApi,
  standardSchemaValidator,
  type Validator,
  type StandardSchemaV1,
} from '@tanstack/react-form';
import { toast } from 'sonner';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import {
  ROLLUP_FUNCTIONS,
  TIME_ZONE_LIST,
  checkFieldNotNullValidationEnabled,
  checkFieldUniqueValidationEnabled,
  isComputedFieldType,
  type ITableFieldInput,
  tableFieldInputSchema,
} from '@teable/v2-core';
import type { IListTablesOkResponseDto, ITableDto } from '@teable/v2-contract-http';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useOrpcClient } from '@/lib/orpc/OrpcClientContext';
import { FieldFormOptions } from './FieldFormOptions';

interface FieldFormProps {
  baseId: string;
  tableId: string;
  onCancel: () => void;
  onSuccess: () => void;
}

type FieldOptionsValue = Extract<ITableFieldInput, { options?: unknown }>['options'];
type FieldFormValues = Omit<ITableFieldInput, 'options'> & { options?: FieldOptionsValue };
type FieldFormValidator = Validator<FieldFormValues, StandardSchemaV1<FieldFormValues>>;
type LinkFieldOptions = Extract<ITableFieldInput, { type: 'link' }>['options'];
type RollupFieldConfig = Extract<ITableFieldInput, { type: 'rollup' }>['config'];
type RollupFieldOptions = Extract<ITableFieldInput, { type: 'rollup' }>['options'];
type LookupFieldOptions = Extract<ITableFieldInput, { type: 'lookup' }>['options'];
type FieldType = ITableFieldInput['type'];

export type FieldFormApi = ReactFormApi<FieldFormValues, FieldFormValidator>;

export function FieldForm({ baseId, tableId, onCancel, onSuccess }: FieldFormProps) {
  const orpc = createTanstackQueryUtils(useOrpcClient());
  const validatorAdapter = standardSchemaValidator() as FieldFormValidator;

  const tablesQuery = useQuery<IListTablesOkResponseDto, Error, ReadonlyArray<ITableDto>>(
    orpc.tables.list.queryOptions({
      input: { baseId },
      select: (response) => response.data.tables,
    })
  );

  const createFieldMutation = useMutation(
    orpc.tables.createField.mutationOptions({
      onSuccess: () => {
        onSuccess();
      },
      onError: (error: any) => {
        toast.error(error.message || 'Failed to create field');
      },
    })
  );

  const typeDrafts = useRef<
    Partial<
      Record<
        FieldType,
        {
          options?: FieldOptionsValue;
          config?: RollupFieldConfig;
          notNull?: boolean;
          unique?: boolean;
        }
      >
    >
  >({});

  const defaultLinkOptions = (): LinkFieldOptions => {
    const tables = tablesQuery.data ?? [];
    const candidates = tables.filter((table) => table.id !== tableId);
    const target = candidates[0];
    if (!target) {
      return { relationship: 'manyMany' } as any;
    }
    const lookupField = target.fields.find((field) => field.isPrimary) ?? target.fields[0];
    if (!lookupField) {
      return { relationship: 'manyMany', foreignTableId: target.id } as any;
    }
    return {
      relationship: 'manyMany',
      foreignTableId: target.id,
      lookupFieldId: lookupField.id,
    } as any;
  };

  const defaultRollupConfig = (): RollupFieldConfig => {
    const tables = tablesQuery.data ?? [];
    const currentTable = tables.find((table) => table.id === tableId);
    const linkField = currentTable?.fields.find((field) => field.type === 'link') as
      | Extract<ITableDto['fields'][number], { type: 'link' }>
      | undefined;
    if (!linkField || linkField.type !== 'link') {
      return {} as any;
    }
    const foreignTableId = linkField.options?.foreignTableId;
    const foreignTable = tables.find((table) => table.id === foreignTableId);
    const lookupField =
      foreignTable?.fields.find((field) => field.isPrimary) ?? foreignTable?.fields[0];
    return {
      linkFieldId: linkField.id,
      foreignTableId: foreignTableId ?? '',
      lookupFieldId: lookupField?.id ?? linkField.options?.lookupFieldId ?? '',
    } as any;
  };

  const defaultRollupOptions = (): RollupFieldOptions => {
    return {
      expression: ROLLUP_FUNCTIONS[0],
      timeZone: TIME_ZONE_LIST[0],
    } as any;
  };

  const defaultLookupOptions = (): LookupFieldOptions => {
    const tables = tablesQuery.data ?? [];
    const currentTable = tables.find((table) => table.id === tableId);
    const linkField = currentTable?.fields.find((field) => field.type === 'link') as
      | Extract<ITableDto['fields'][number], { type: 'link' }>
      | undefined;
    if (!linkField || linkField.type !== 'link') {
      return {} as any;
    }
    const foreignTableId = linkField.options?.foreignTableId;
    const foreignTable = tables.find((table) => table.id === foreignTableId);
    const lookupField =
      foreignTable?.fields.find((field) => field.isPrimary) ?? foreignTable?.fields[0];
    return {
      linkFieldId: linkField.id,
      foreignTableId: foreignTableId ?? '',
      lookupFieldId: lookupField?.id ?? linkField.options?.lookupFieldId ?? '',
    } as any;
  };

  const defaultFormulaOptions = () => {
    return {
      expression: '1',
    } as any;
  };

  const defaultConditionalRollupConfig = () => {
    const tables = tablesQuery.data ?? [];
    const candidates = tables.filter((table) => table.id !== tableId);
    const foreignTable = candidates[0];
    const lookupField =
      foreignTable?.fields.find((field) => field.isPrimary) ?? foreignTable?.fields[0];
    return {
      foreignTableId: foreignTable?.id ?? '',
      lookupFieldId: lookupField?.id ?? '',
      condition: { filter: null },
    } as any;
  };

  const defaultConditionalRollupOptions = () => {
    return {
      expression: ROLLUP_FUNCTIONS[0],
      timeZone: TIME_ZONE_LIST[0],
    } as any;
  };

  const defaultConditionalLookupOptions = () => {
    const tables = tablesQuery.data ?? [];
    const candidates = tables.filter((table) => table.id !== tableId);
    const foreignTable = candidates[0];
    const lookupField =
      foreignTable?.fields.find((field) => field.isPrimary) ?? foreignTable?.fields[0];
    return {
      foreignTableId: foreignTable?.id ?? '',
      lookupFieldId: lookupField?.id ?? '',
      condition: { filter: null },
    } as any;
  };

  const getDefaultValuesForType = (
    type: FieldType
  ): { options?: FieldOptionsValue; config?: RollupFieldConfig } => {
    switch (type) {
      case 'link':
        return { options: defaultLinkOptions() };
      case 'formula':
        return { options: defaultFormulaOptions() };
      case 'rollup':
        return { options: defaultRollupOptions(), config: defaultRollupConfig() };
      case 'lookup':
        return { options: defaultLookupOptions() };
      case 'conditionalRollup':
        return {
          options: defaultConditionalRollupOptions(),
          config: defaultConditionalRollupConfig(),
        };
      case 'conditionalLookup':
        return { options: defaultConditionalLookupOptions() };
      default:
        return { options: {} };
    }
  };

  const form = useForm<FieldFormValues, FieldFormValidator>({
    defaultValues: {
      type: 'singleLineText',
      name: '',
      options: {},
    } as FieldFormValues,
    validatorAdapter,
    validators: {
      onChange: tableFieldInputSchema,
      onBlur: tableFieldInputSchema,
    },
    onSubmit: async ({ value }: { value: FieldFormValues }) => {
      createFieldMutation.mutate({
        baseId,
        tableId,
        field: value,
      } as any);
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      className="space-y-6"
    >
      <form.Field
        name="name"
        children={(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Field Name</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="Enter field name"
            />
            {field.state.meta.errors ? (
              <p className="text-xs text-destructive">{field.state.meta.errors.join(', ')}</p>
            ) : null}
          </div>
        )}
      />

      <form.Field
        name="type"
        children={(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Field Type</Label>
            <Select
              value={field.state.value}
              onValueChange={(value) => {
                const nextType = value as FieldType;
                const currentType = form.getFieldValue('type') as FieldType;
                const currentOptions = form.getFieldValue('options') as
                  | FieldOptionsValue
                  | undefined;
                const currentConfig = form.getFieldValue('config' as any) as
                  | RollupFieldConfig
                  | undefined;
                const currentNotNull = form.getFieldValue('notNull' as any) as boolean | undefined;
                const currentUnique = form.getFieldValue('unique' as any) as boolean | undefined;
                typeDrafts.current[currentType] = {
                  options: currentOptions,
                  config: currentConfig,
                  notNull: currentNotNull,
                  unique: currentUnique,
                };

                const draft = typeDrafts.current[nextType];
                const defaults = getDefaultValuesForType(nextType);
                const nextOptions = draft?.options ?? defaults.options;
                const nextConfig =
                  nextType === 'rollup' || nextType === 'conditionalRollup'
                    ? draft?.config ?? defaults.config
                    : undefined;
                const isComputed = isComputedFieldType(nextType);
                const notNullEnabled = checkFieldNotNullValidationEnabled(nextType, {
                  isComputed,
                });
                const uniqueEnabled = checkFieldUniqueValidationEnabled(nextType, {
                  isComputed,
                });
                const nextNotNull = notNullEnabled ? draft?.notNull : undefined;
                const nextUnique = uniqueEnabled ? draft?.unique : undefined;

                const nextValues: FieldFormValues = {
                  ...form.state.values,
                  type: nextType,
                  options: nextOptions,
                  notNull: nextNotNull,
                  unique: nextUnique,
                };

                if (nextType === 'rollup' || nextType === 'conditionalRollup') {
                  (nextValues as FieldFormValues & { config?: RollupFieldConfig }).config =
                    nextConfig;
                }

                form.reset(nextValues);
                field.handleChange(nextType as any);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a field type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="singleLineText">Text</SelectItem>
                <SelectItem value="longText">Long Text</SelectItem>
                <SelectItem value="number">Number</SelectItem>
                <SelectItem value="autoNumber">Auto Number</SelectItem>
                <SelectItem value="rating">Rating</SelectItem>
                <SelectItem value="singleSelect">Single Select</SelectItem>
                <SelectItem value="multipleSelect">Multiple Select</SelectItem>
                <SelectItem value="checkbox">Checkbox</SelectItem>
                <SelectItem value="attachment">Attachment</SelectItem>
                <SelectItem value="date">Date</SelectItem>
                <SelectItem value="createdTime">Created Time</SelectItem>
                <SelectItem value="lastModifiedTime">Last Modified Time</SelectItem>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="createdBy">Created By</SelectItem>
                <SelectItem value="lastModifiedBy">Last Modified By</SelectItem>
                <SelectItem value="button">Button</SelectItem>
                <SelectItem value="formula">Formula</SelectItem>
                <SelectItem value="link">Link</SelectItem>
                <SelectItem value="rollup">Rollup</SelectItem>
                <SelectItem value="lookup">Lookup</SelectItem>
                <SelectItem value="conditionalRollup">Conditional Rollup</SelectItem>
                <SelectItem value="conditionalLookup">Conditional Lookup</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      />

      <form.Subscribe
        selector={(state) => state.values.type}
        children={(type) => (
          <FieldFormOptions
            key={type}
            type={type}
            form={form as FieldFormApi}
            tableId={tableId}
            tables={tablesQuery.data ?? []}
            isTablesLoading={tablesQuery.isLoading}
          />
        )}
      />

      <div className="flex justify-end gap-3 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <form.Subscribe
          selector={(state) => [state.canSubmit, state.isSubmitting] as const}
          children={([canSubmit, isSubmitting]) => (
            <Button
              type="submit"
              disabled={!canSubmit || isSubmitting || createFieldMutation.isPending}
            >
              {createFieldMutation.isPending ? 'Creating...' : 'Create Field'}
            </Button>
          )}
        />
      </div>
    </form>
  );
}
