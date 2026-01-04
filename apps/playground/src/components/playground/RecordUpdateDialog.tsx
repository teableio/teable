import {
  useForm,
  standardSchemaValidator,
  type StandardSchemaV1,
  type Validator,
} from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import type { ITableRecordDto } from '@teable/v2-contract-http';
import { type Table as TableAggregate } from '@teable/v2-core';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { z, type ZodTypeAny } from 'zod';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useOrpcClient } from '@/lib/orpc/OrpcClientContext';
import { FieldInput } from './field-inputs';

interface RecordUpdateDialogProps {
  table: TableAggregate;
  record: ITableRecordDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  baseId?: string;
}

type RecordFieldValues = Record<string, unknown>;
type RecordFormValidator = Validator<RecordFieldValues, StandardSchemaV1<RecordFieldValues>>;

const useRecordInputSchema = (
  table: TableAggregate
): z.ZodObject<Record<string, ZodTypeAny>> | null => {
  return useMemo(() => {
    const schemaResult = table.createRecordInputSchema();
    if (schemaResult.isErr()) {
      console.error('Failed to create record input schema:', schemaResult.error);
      return null;
    }
    return schemaResult.value;
  }, [table]);
};

export function RecordUpdateDialog({
  table,
  record,
  open,
  onOpenChange,
  onSuccess,
  baseId,
}: RecordUpdateDialogProps) {
  const orpcClient = useOrpcClient();
  const orpc = createTanstackQueryUtils(orpcClient);
  const queryClient = useQueryClient();
  const tableId = table.id().toString();

  const editableFields = useMemo(() => table.getEditableFields(), [table]);
  const recordSchema = useRecordInputSchema(table);
  const validatorAdapter = standardSchemaValidator() as RecordFormValidator;

  const defaultValues = useMemo(() => {
    const values: RecordFieldValues = {};
    for (const field of editableFields) {
      const fieldId = field.id().toString();
      const recordValue = record.fields[fieldId];
      if (recordValue !== undefined) {
        values[fieldId] = recordValue;
        continue;
      }
      values[fieldId] = field.type().toString() === 'checkbox' ? false : null;
    }
    return values;
  }, [editableFields, record]);

  const updateRecordMutation = useMutation(
    orpc.tables.updateRecord.mutationOptions({
      onSuccess: () => {
        toast.success('Record updated');
        void queryClient.invalidateQueries({
          queryKey: orpc.tables.listRecords.queryKey({ input: { tableId } }),
        });
        onSuccess?.();
        onOpenChange(false);
      },
      onError: (error: Error) => {
        toast.error(error.message || 'Failed to update record');
      },
    })
  );

  const form = useForm<RecordFieldValues, RecordFormValidator>({
    defaultValues,
    validatorAdapter,
    validators: recordSchema
      ? {
          onSubmit: recordSchema,
        }
      : {},
    onSubmit: async ({ value }) => {
      const fields: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        if (val !== undefined) fields[key] = val;
      }
      updateRecordMutation.mutate({
        tableId,
        recordId: record.id,
        fields,
      });
    },
  });

  const lastOpenRef = useRef(false);
  const lastRecordIdRef = useRef<string | null>(null);

  useEffect(() => {
    const wasOpen = lastOpenRef.current;
    lastOpenRef.current = open;
    if (!open) return;
    const recordChanged = lastRecordIdRef.current !== record.id;
    if (!wasOpen || recordChanged) {
      lastRecordIdRef.current = record.id;
      form.reset(defaultValues);
      updateRecordMutation.reset();
    }
  }, [open, record.id, defaultValues, form, updateRecordMutation]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      onOpenChange(nextOpen);
      if (!nextOpen) {
        form.reset(defaultValues);
        updateRecordMutation.reset();
      }
    },
    [defaultValues, form, onOpenChange, updateRecordMutation]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-4">
          <DialogTitle>Update Record</DialogTitle>
          <DialogDescription>
            Update the values for this record. Fields marked with * are required.
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
                  disabled={!canSubmit || isSubmitting || updateRecordMutation.isPending}
                >
                  {updateRecordMutation.isPending ? 'Updating...' : 'Update'}
                </Button>
              )}
            />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
