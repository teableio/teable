import {
  useForm,
  standardSchemaValidator,
  type StandardSchemaV1,
  type Validator,
} from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import type { ITableRecordDto, IExplainResultDto } from '@teable/v2-contract-http';
import {
  type Table as TableAggregate,
  type SingleSelectField,
  type MultipleSelectField,
} from '@teable/v2-core';
import { Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { z, type ZodTypeAny } from 'zod';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { ExplainResultPanel } from './ExplainResultPanel';

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
  const [explainResult, setExplainResult] = useState<IExplainResultDto | null>(null);
  const [explainDialogOpen, setExplainDialogOpen] = useState(false);
  const [analyzeMode, setAnalyzeMode] = useState(true);
  const orpcClient = useOrpcClient();
  const orpc = createTanstackQueryUtils(orpcClient);
  const queryClient = useQueryClient();
  const tableId = table.id().toString();

  const editableFields = useMemo(() => table.getEditableFields(), [table]);
  const recordSchema = useRecordInputSchema(table);
  const validatorAdapter = standardSchemaValidator() as RecordFormValidator;

  const normalizeSelectValue = useCallback(
    (field: SingleSelectField | MultipleSelectField, value: unknown): string | null => {
      if (value === null || value === undefined) return null;
      const options = field.selectOptions();
      const findById = (id: string) => options.find((option) => option.id().toString() === id);
      const findByName = (name: string) =>
        options.find((option) => option.name().toString() === name);
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        return findById(trimmed)?.id().toString() ?? findByName(trimmed)?.id().toString() ?? null;
      }
      if (typeof value === 'object') {
        const candidate = value as { id?: unknown; name?: unknown };
        if (typeof candidate.id === 'string') {
          return findById(candidate.id)?.id().toString() ?? candidate.id;
        }
        if (typeof candidate.name === 'string') {
          return findByName(candidate.name)?.id().toString() ?? candidate.name;
        }
      }
      return null;
    },
    []
  );

  const defaultValues = useMemo(() => {
    const values: RecordFieldValues = {};
    for (const field of editableFields) {
      const fieldId = field.id().toString();
      const fieldType = field.type().toString();
      const recordValue = record.fields[fieldId];
      if (recordValue !== undefined) {
        if (fieldType === 'date' && recordValue instanceof Date) {
          values[fieldId] = recordValue.toISOString();
          continue;
        }
        if (fieldType === 'singleSelect') {
          values[fieldId] = normalizeSelectValue(field as SingleSelectField, recordValue);
          continue;
        }
        if (fieldType === 'multipleSelect') {
          const entries = Array.isArray(recordValue) ? recordValue : [recordValue];
          const normalized = entries
            .map((entry) => normalizeSelectValue(field as MultipleSelectField, entry))
            .filter((entry): entry is string => Boolean(entry));
          values[fieldId] = normalized.length > 0 ? normalized : null;
          continue;
        }
        values[fieldId] = recordValue;
        continue;
      }
      values[fieldId] = fieldType === 'checkbox' ? false : null;
    }
    return values;
  }, [editableFields, normalizeSelectValue, record]);

  const updateRecordMutation = useMutation(
    orpc.tables.updateRecord.mutationOptions({
      onSuccess: () => {
        toast.success('Record updated');
        void queryClient.invalidateQueries({
          queryKey: orpc.tables.listRecords.queryKey({ input: { tableId } }),
        });
        onSuccess?.();
        setExplainResult(null);
        onOpenChange(false);
      },
      onError: (error: Error) => {
        toast.error(error.message || 'Failed to update record');
      },
    })
  );

  const explainMutation = useMutation(
    orpc.tables.explainUpdateRecord.mutationOptions({
      onSuccess: (response) => {
        setExplainResult(response.data);
        setExplainDialogOpen(true);
      },
      onError: (error: Error) => {
        toast.error(error.message || 'Failed to explain command');
      },
    })
  );

  const form = useForm<RecordFieldValues, RecordFormValidator>({
    defaultValues,
    validatorAdapter,
    validators: recordSchema ? { onSubmit: recordSchema } : {},
    onSubmit: async ({ value, formApi }) => {
      const fields: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        if (formApi.state.fieldMeta[key]?.isDirty) {
          fields[key] = val;
        }
      }
      if (Object.keys(fields).length === 0) {
        toast.info('No changes to update');
        return;
      }
      updateRecordMutation.mutate({ tableId, recordId: record.id, fields });
    },
  });

  const handleExplain = useCallback(() => {
    const value = form.state.values;
    const fields: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (form.state.fieldMeta[key]?.isDirty) {
        fields[key] = val;
      }
    }
    if (Object.keys(fields).length === 0) {
      toast.info('No changes to explain');
      return;
    }
    explainMutation.mutate({
      tableId,
      recordId: record.id,
      fields,
      analyze: analyzeMode,
      includeSql: true,
      includeGraph: false,
    });
  }, [explainMutation, form.state.values, form.state.fieldMeta, tableId, record.id, analyzeMode]);

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
      explainMutation.reset();
      setExplainResult(null);
    }
  }, [open, record.id, defaultValues, form, updateRecordMutation, explainMutation]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      onOpenChange(nextOpen);
      if (!nextOpen) {
        form.reset(defaultValues);
        updateRecordMutation.reset();
        explainMutation.reset();
        setExplainResult(null);
      }
    },
    [defaultValues, form, onOpenChange, updateRecordMutation, explainMutation]
  );

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-lg p-0 overflow-hidden flex flex-col max-h-[85vh]">
          <DialogHeader className="p-6 pb-4">
            <DialogTitle>Update Record</DialogTitle>
            <DialogDescription>
              Update the values for this record. Fields marked with * are required.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col flex-1 min-h-0"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
          >
            <div className="flex-1 overflow-y-auto px-6">
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

            <div className="flex justify-between gap-3 p-6 pt-4 border-t bg-background">
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleExplain}
                  disabled={explainMutation.isPending}
                  className="text-muted-foreground"
                >
                  <Search className="mr-1.5 h-3.5 w-3.5" />
                  {explainMutation.isPending ? 'Analyzing...' : 'Explain'}
                </Button>
                <div className="flex items-center gap-1.5">
                  <Checkbox
                    id="analyze-mode"
                    checked={analyzeMode}
                    onCheckedChange={(checked) => setAnalyzeMode(!!checked)}
                  />
                  <Label
                    htmlFor="analyze-mode"
                    className="text-xs text-muted-foreground cursor-pointer"
                  >
                    ANALYZE
                  </Label>
                </div>
              </div>
              <div className="flex gap-3">
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
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={explainDialogOpen} onOpenChange={setExplainDialogOpen}>
        <DialogContent className="sm:max-w-[90vw] w-[90vw] max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Explain: Update Record</DialogTitle>
            <DialogDescription>Analysis of the update record operation</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            {explainResult && <ExplainResultPanel result={explainResult} />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
