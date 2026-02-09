import {
  useForm,
  standardSchemaValidator,
  type Validator,
  type StandardSchemaV1,
} from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import { type Table as TableAggregate, type LinkField } from '@teable/v2-core';
import type { IExplainResultDto } from '@teable/v2-contract-http';
import { Plus, Search } from 'lucide-react';
import { useMemo, useState, useCallback } from 'react';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useOrpcClient } from '@/lib/orpc/OrpcClientContext';
import { LinkFieldLabel } from '@/components/playground/LinkFieldLabel';
import { FieldInput } from './field-inputs';
import { ExplainResultPanel } from './ExplainResultPanel';

interface RecordCreateDialogProps {
  table: TableAggregate;
  onSuccess?: () => void;
  baseId?: string;
}

type RecordFieldValues = Record<string, unknown>;
type RecordFormValidator = Validator<RecordFieldValues, StandardSchemaV1<RecordFieldValues>>;

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

  const defaultValues = useMemo(() => {
    const values: RecordFieldValues = {};
    for (const field of editableFields) {
      const fieldType = field.type().toString();
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
        form.reset();
        setOpen(false);
        setExplainResult(null);
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

  const explainMutation = useMutation(
    orpc.tables.explainCreateRecord.mutationOptions({
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
    onSubmit: async ({ value }) => {
      const filteredFields: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        if (val !== null && val !== undefined && val !== '') {
          filteredFields[key] = val;
        }
      }
      createRecordMutation.mutate({ tableId, fields: filteredFields });
    },
  });

  const handleExplain = useCallback(() => {
    const value = form.state.values;
    const filteredFields: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (val !== null && val !== undefined && val !== '') {
        filteredFields[key] = val;
      }
    }
    explainMutation.mutate({
      tableId,
      fields: filteredFields,
      analyze: analyzeMode,
      includeSql: true,
      includeGraph: false,
    });
  }, [explainMutation, form.state.values, tableId, analyzeMode]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen) {
        form.reset();
        createRecordMutation.reset();
        explainMutation.reset();
        setExplainResult(null);
      }
    },
    [form, createRecordMutation, explainMutation]
  );

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button size="sm" className="h-8">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Create Record
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-lg p-0 overflow-hidden flex flex-col max-h-[85vh]">
          <DialogHeader className="p-6 pb-4">
            <DialogTitle>Create Record</DialogTitle>
            <DialogDescription>
              Fill in the fields below to create a new record. Fields marked with * are required.
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
                      const fieldType = field.type().toString();
                      const fieldName = field.name().toString();
                      const isLinkField = fieldType === 'link';
                      const linkField = isLinkField ? (field as LinkField) : null;
                      return (
                        <div className="space-y-2">
                          <Label htmlFor={field.id().toString()}>
                            {isLinkField && linkField ? (
                              <LinkFieldLabel
                                name={fieldName}
                                fieldId={linkField.id().toString()}
                                relationship={linkField.relationship().toString()}
                                isOneWay={linkField.isOneWay()}
                              />
                            ) : (
                              <span>{fieldName}</span>
                            )}
                            {isRequired && <span className="text-destructive ml-1">*</span>}
                            <span className="ml-2 text-xs text-muted-foreground font-normal">
                              ({fieldType})
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
                    id="analyze-mode-create"
                    checked={analyzeMode}
                    onCheckedChange={(checked) => setAnalyzeMode(!!checked)}
                  />
                  <Label
                    htmlFor="analyze-mode-create"
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
                      disabled={!canSubmit || isSubmitting || createRecordMutation.isPending}
                    >
                      {createRecordMutation.isPending ? 'Creating...' : 'Create'}
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
            <DialogTitle>Explain: Create Record</DialogTitle>
            <DialogDescription>Analysis of the create record operation</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            {explainResult && <ExplainResultPanel result={explainResult} />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
