import {
  useForm,
  standardSchemaValidator,
  type Validator,
  type StandardSchemaV1,
} from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import { type Table as TableAggregate } from '@teable/v2-core';
import { Plus } from 'lucide-react';
import { useMemo, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { z, type ZodTypeAny } from 'zod';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useOrpcClient } from '@/lib/orpc/OrpcClientContext';
import { FieldInput } from './field-inputs';

interface RecordCreateDialogProps {
  table: TableAggregate;
  onSuccess?: () => void;
  baseId?: string;
}

type RecordFieldValues = Record<string, unknown>;
type RecordFormValidator = Validator<RecordFieldValues, StandardSchemaV1<RecordFieldValues>>;

/**
 * Hook to get the record input schema from the table.
 * Uses table.createRecordInputSchema() internally.
 */
function useRecordInputSchema(
  table: TableAggregate
): z.ZodObject<Record<string, ZodTypeAny>> | null {
  return useMemo(() => {
    const schemaResult = table.createRecordInputSchema();
    if (schemaResult.isErr()) {
      console.error('Failed to create record input schema:', schemaResult.error);
      return null;
    }
    return schemaResult.value;
  }, [table]);
}

export function RecordCreateDialog({ table, onSuccess, baseId }: RecordCreateDialogProps) {
  const [open, setOpen] = useState(false);
  const orpcClient = useOrpcClient();
  const orpc = createTanstackQueryUtils(orpcClient);
  const queryClient = useQueryClient();

  const tableId = table.id().toString();

  // Use table methods to get editable fields and schema
  const editableFields = useMemo(() => table.getEditableFields(), [table]);
  const recordSchema = useRecordInputSchema(table);

  const validatorAdapter = standardSchemaValidator() as RecordFormValidator;

  // Build default values from editable fields
  const defaultValues = useMemo(() => {
    const values: RecordFieldValues = {};
    for (const field of editableFields) {
      const fieldType = field.type().toString();
      // Set default value based on type
      if (fieldType === 'checkbox') {
        values[field.id().toString()] = false;
      } else {
        values[field.id().toString()] = null;
      }
    }
    return values;
  }, [editableFields]);

  const createRecordMutation = useMutation(
    orpc.tables.createRecord.mutationOptions({
      onSuccess: () => {
        toast.success('Record created');
        // Reset form and close dialog
        form.reset();
        setOpen(false);
        // Invalidate records query to refetch
        void queryClient.invalidateQueries({
          queryKey: orpc.tables.listRecords.queryKey({ input: { tableId } }),
        });
        onSuccess?.();
      },
      onError: (error: Error) => {
        toast.error(error.message || 'Failed to create record');
      },
    })
  );

  const form = useForm<RecordFieldValues, RecordFormValidator>({
    defaultValues,
    validatorAdapter,
    // Only validate on submit to avoid validating all fields on individual blur
    validators: recordSchema
      ? {
          onSubmit: recordSchema,
        }
      : {},
    onSubmit: async ({ value }) => {
      // Filter out null values for optional fields
      const filteredFields: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        if (val !== null && val !== undefined && val !== '') {
          filteredFields[key] = val;
        }
      }
      createRecordMutation.mutate({
        tableId,
        fields: filteredFields,
      });
    },
  });

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen) {
        form.reset();
        createRecordMutation.reset();
      }
    },
    [form, createRecordMutation]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs font-normal">
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Create Record
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-4">
          <DialogTitle>Create Record</DialogTitle>
          <DialogDescription>
            Fill in the values for the new record. Fields marked with * are required.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
        >
          <div className="max-h-[50vh] overflow-y-auto px-6">
            <div className="space-y-4 pb-4">
              {editableFields.map((field) => (
                <form.Field
                  key={field.id().toString()}
                  name={field.id().toString()}
                  children={(formField) => {
                    const isRequired = field.notNull().toBoolean();
                    return (
                      <div className="space-y-2">
                        <Label htmlFor={field.id().toString()}>
                          {field.name().toString()}
                          {isRequired && <span className="text-destructive ml-1">*</span>}
                          <span className="ml-2 text-xs text-muted-foreground font-normal">
                            ({field.type().toString()})
                          </span>
                        </Label>
                        <FieldInput
                          field={field}
                          value={formField.state.value}
                          onChange={formField.handleChange}
                          onBlur={formField.handleBlur}
                          orpcClient={orpcClient}
                          baseId={baseId}
                        />
                        {formField.state.meta.errors.length > 0 && (
                          <p className="text-xs text-destructive">
                            {formField.state.meta.errors.join(', ')}
                          </p>
                        )}
                      </div>
                    );
                  }}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-3 p-6 pt-4 border-t bg-background">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <form.Subscribe
              selector={(state) => [state.canSubmit, state.isSubmitting] as const}
              children={([canSubmit, isSubmitting]) => (
                <Button
                  type="submit"
                  disabled={!canSubmit || isSubmitting || createRecordMutation.isPending}
                >
                  {createRecordMutation.isPending ? 'Creating...' : 'Create'}
                </Button>
              )}
            />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
