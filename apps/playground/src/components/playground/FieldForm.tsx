import {
  useForm,
  type ReactFormApi,
  standardSchemaValidator,
  type Validator,
  type StandardSchemaV1,
} from '@tanstack/react-form';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import { type ITableFieldInput, tableFieldInputSchema } from '@teable/v2-core';
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
import { getOrpcClient } from '@/lib/orpcClient';
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

export type FieldFormApi = ReactFormApi<FieldFormValues, FieldFormValidator>;

export function FieldForm({ baseId, tableId, onCancel, onSuccess }: FieldFormProps) {
  const queryClient = useQueryClient();
  const orpc = createTanstackQueryUtils(getOrpcClient());
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
        toast.success('Field created successfully');
        void queryClient.invalidateQueries({
          queryKey: orpc.tables.getById.queryKey({
            input: { baseId, tableId },
          }),
        });
        onSuccess();
      },
      onError: (error: any) => {
        toast.error(error.message || 'Failed to create field');
      },
    })
  );

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
                field.handleChange(value as any);
                if (value === 'link') {
                  form.setFieldValue('options', defaultLinkOptions() as any);
                } else {
                  form.setFieldValue('options', {} as any);
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a field type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="singleLineText">Text</SelectItem>
                <SelectItem value="longText">Long Text</SelectItem>
                <SelectItem value="number">Number</SelectItem>
                <SelectItem value="rating">Rating</SelectItem>
                <SelectItem value="singleSelect">Single Select</SelectItem>
                <SelectItem value="multipleSelect">Multiple Select</SelectItem>
                <SelectItem value="checkbox">Checkbox</SelectItem>
                <SelectItem value="attachment">Attachment</SelectItem>
                <SelectItem value="date">Date</SelectItem>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="button">Button</SelectItem>
                <SelectItem value="formula">Formula</SelectItem>
                <SelectItem value="link">Link</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      />

      <form.Subscribe
        selector={(state) => state.values.type}
        children={(type) => (
          <FieldFormOptions
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
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              {createFieldMutation.isPending ? 'Creating...' : 'Create Field'}
            </Button>
          )}
        />
      </div>
    </form>
  );
}
