import { FieldType } from '@teable/core';
import { useFieldStaticGetter } from '@teable/sdk/hooks';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@teable/ui-lib/shadcn';
import {
  AlertTriangle,
  ChevronDown,
  CheckCircle2,
  Clock,
  Columns3,
  ExternalLink,
  Info,
  Loader2,
  RefreshCcw,
  Table2,
  Wrench,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import {
  getLocalizedDetailItems,
  getLocalizedRepairDescription,
  getLocalizedRepairReason,
  getLocalizedResultMessage,
  getLocalizedRuleDescription,
  getGroupDisplayName,
  getGroupDisplayState,
  hasExecutableRepairStatements,
  integrityFilterStatuses,
  getPhaseText,
  translateIntegrityMessage,
  type GroupDisplayState,
  type IntegrityFilterStatus,
  type IntegrityPhase,
  type IntegrityResult,
  type IntegrityScope,
  type IntegritySummary,
  type ResultGroup,
  type TableResultGroup,
  type Translate,
} from './integrityV2Utils';

const StatusIcon = ({ status }: { status: IntegrityResult['status'] }) => {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="size-4 text-green-500" />;
    case 'error':
      return <XCircle className="size-4 text-destructive" />;
    case 'warn':
      return <AlertTriangle className="size-4 text-yellow-500" />;
    case 'skipped':
      return <Clock className="size-4 text-muted-foreground" />;
    case 'running':
      return <Loader2 className="size-4 animate-spin text-blue-500" />;
    case 'pending':
    default:
      return <Clock className="size-4 text-muted-foreground" />;
  }
};

const StatusBadge = ({ status }: { status: IntegrityResult['status'] }) => {
  const { t } = useTranslation(['table']);

  return (
    <Badge
      variant="outline"
      className="h-5 border-border px-1.5 text-[10px] font-normal uppercase text-muted-foreground"
    >
      {t(`table:table.integrity.v2.status.${status}`)}
    </Badge>
  );
};

const OutcomeBadge = ({ result }: { result: IntegrityResult }) => {
  const { t } = useTranslation(['table']);

  if (!('outcome' in result) || !result.outcome) {
    return null;
  }

  return (
    <Badge
      variant="outline"
      className="h-5 border-border px-1.5 text-[10px] font-normal uppercase text-muted-foreground"
    >
      {t(`table:table.integrity.v2.outcome.${result.outcome}`)}
    </Badge>
  );
};

const SYSTEM_FIELD_TYPE_MAP: Record<string, FieldType> = {
  __id: FieldType.SingleLineText,
  __auto_number: FieldType.AutoNumber,
  __created_time: FieldType.CreatedTime,
  __last_modified_time: FieldType.LastModifiedTime,
  __created_by: FieldType.CreatedBy,
  __last_modified_by: FieldType.LastModifiedBy,
  __version: FieldType.Number,
};

const getSystemFieldType = (fieldId: string) => {
  if (!fieldId.startsWith('__system__:')) {
    return undefined;
  }

  return SYSTEM_FIELD_TYPE_MAP[fieldId.replace('__system__:', '')];
};

const getRuleType = (ruleId: string) => ruleId.split(':')[0];

const getColumnDataType = (ruleDescription: string) => {
  const match = ruleDescription.match(/\(([^()]+)\)\s*$/);
  return match?.[1]?.toLowerCase();
};

const DB_TYPE_TO_FIELD_TYPE: Record<string, FieldType> = {
  text: FieldType.SingleLineText,
  varchar: FieldType.SingleLineText,
  'character varying': FieldType.SingleLineText,
  integer: FieldType.Number,
  bigint: FieldType.Number,
  numeric: FieldType.Number,
  real: FieldType.Number,
  'double precision': FieldType.Number,
  timestamptz: FieldType.Date,
  timestamp: FieldType.Date,
  date: FieldType.Date,
  boolean: FieldType.Checkbox,
};

const inferFieldTypeFromReferenceRule = (description: string) => {
  if (description.includes('conditional rollup')) {
    return { type: FieldType.ConditionalRollup };
  }

  if (description.includes('rollup')) {
    return { type: FieldType.Rollup };
  }

  if (description.includes('conditional lookup')) {
    return { type: FieldType.Link, isLookup: true, isConditionalLookup: true };
  }

  if (description.includes('lookup field') || description.includes('lookup-link field')) {
    return { type: FieldType.Link, isLookup: true };
  }

  return undefined;
};

const inferFieldTypeFromRule = (result: IntegrityResult) => {
  const ruleType = getRuleType(result.ruleId);
  const description = result.ruleDescription.toLowerCase();

  if (
    ruleType === 'link_value_column' ||
    ruleType === 'fk_column' ||
    ruleType === 'order_column' ||
    ruleType === 'field_meta' ||
    ruleType === 'symmetric_field'
  ) {
    return { type: FieldType.Link };
  }

  if (ruleType === 'reference') {
    return inferFieldTypeFromReferenceRule(description);
  }

  if (ruleType === 'generated_column' || ruleType === 'generated_meta') {
    return { type: FieldType.Formula };
  }

  if (ruleType === 'column' || ruleType === 'system_column') {
    const columnDataType = getColumnDataType(result.ruleDescription);
    if (columnDataType && DB_TYPE_TO_FIELD_TYPE[columnDataType]) {
      return { type: DB_TYPE_TO_FIELD_TYPE[columnDataType] };
    }
  }

  return undefined;
};

const inferFieldTypeFromGroup = (group: ResultGroup) => {
  const systemFieldType = getSystemFieldType(group.fieldId);
  if (systemFieldType) {
    return { type: systemFieldType };
  }

  for (const result of group.results) {
    const inferredFieldType = inferFieldTypeFromRule(result);
    if (inferredFieldType) {
      return inferredFieldType;
    }
  }

  return undefined;
};

type ManualRepairSchema = NonNullable<NonNullable<IntegrityResult['repair']>['manualRepairSchema']>;
type ManualRepairProperty = ManualRepairSchema['properties'][string];
type ManualRepairValues = Record<string, string | boolean>;
type RepairRuleHandler = (
  result: IntegrityResult,
  manualRepairValues?: ManualRepairValues
) => Promise<boolean>;
type RepairRulePreviewHandler = (
  result: IntegrityResult,
  manualRepairValues?: ManualRepairValues
) => Promise<IntegrityResult[]>;

const getManualRepairDefaultValues = (manualRepairSchema?: ManualRepairSchema) => {
  return Object.fromEntries(
    Object.entries(manualRepairSchema?.properties || {}).map(([key, property]) => [
      key,
      property.defaultValue ?? (property.type === 'boolean' ? false : ''),
    ])
  ) as Record<string, string | boolean>;
};

const getManualRepairWidget = (property: ManualRepairProperty) => {
  return (
    property.widget ??
    (property.options?.length ? 'select' : property.type === 'boolean' ? 'checkbox' : 'text')
  );
};

const ManualRepairFieldInput = ({
  property,
  value,
  onChange,
  t,
}: {
  property: ManualRepairProperty;
  value: string | boolean | undefined;
  onChange: (value: string | boolean) => void;
  t: Translate;
}) => {
  const widget = getManualRepairWidget(property);

  if (widget === 'select') {
    return (
      <Select value={String(value ?? '')} onValueChange={(nextValue) => onChange(nextValue)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {property.options?.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {translateIntegrityMessage(t, option.label) || option.value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (widget === 'textarea') {
    return (
      <Textarea
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-24"
      />
    );
  }

  if (widget === 'checkbox') {
    return (
      <Checkbox
        checked={Boolean(value)}
        onCheckedChange={(checked) => onChange(checked === true)}
      />
    );
  }

  return <Input value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} />;
};

const ManualRepairDialog = ({
  result,
  triggerLabel,
  onSubmit,
}: {
  result: IntegrityResult;
  triggerLabel: string;
  onSubmit?: (result: IntegrityResult, values: ManualRepairValues) => Promise<boolean> | boolean;
}) => {
  const { t } = useTranslation(['table']);
  const manualRepairSchema = result.repair?.manualRepairSchema;
  const schemaProperties: Array<[string, ManualRepairProperty]> = manualRepairSchema
    ? (Object.entries(manualRepairSchema.properties) as Array<[string, ManualRepairProperty]>)
    : [];
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<ManualRepairValues>(() =>
    getManualRepairDefaultValues(manualRepairSchema)
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const reason = getLocalizedRepairReason(t as Translate, result);
  const description = getLocalizedRepairDescription(t as Translate, result);
  const submitLabel =
    translateIntegrityMessage(t as Translate, manualRepairSchema?.submitLabel) ||
    t('table:table.integrity.v2.repairMeta.manual.apply');

  useEffect(() => {
    setValues(getManualRepairDefaultValues(manualRepairSchema));
  }, [manualRepairSchema, open]);

  if (!result.repair || result.repair.mode !== 'manual') {
    return null;
  }

  const handleSubmit = async () => {
    if (!onSubmit) {
      return;
    }

    setIsSubmitting(true);
    try {
      const submitted = await onSubmit(result, values);
      if (submitted) {
        setOpen(false);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        size="xs"
        variant="secondary"
        className="h-7 px-2 text-xs"
        onClick={() => setOpen(true)}
      >
        <Info className="mr-1 size-3.5" />
        {triggerLabel}
      </Button>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {translateIntegrityMessage(t as Translate, manualRepairSchema?.title) ||
              t('table:table.integrity.v2.manualRepairDialogTitle')}
          </DialogTitle>
          <DialogDescription>
            {translateIntegrityMessage(t as Translate, manualRepairSchema?.description) ||
              description ||
              t('table:table.integrity.v2.manualRepairDialogDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Alert className="border-amber-200 bg-amber-50/70 text-amber-950">
            <AlertDescription className="space-y-1">
              <div className="font-medium">
                {t('table:table.integrity.v2.manualRepairDialogReason')}
              </div>
              <div>{reason || t('table:table.integrity.v2.message.manualRepair')}</div>
            </AlertDescription>
          </Alert>

          {manualRepairSchema ? (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <div className="space-y-3">
                {schemaProperties.map(([key, property]) => {
                  const label = translateIntegrityMessage(t as Translate, property.title) || key;
                  const fieldDescription = translateIntegrityMessage(
                    t as Translate,
                    property.description
                  );
                  const isRequired = manualRepairSchema.required?.includes(key);

                  return (
                    <label key={key} className="block space-y-1.5 text-sm">
                      <div className="font-medium text-foreground">
                        {label}
                        {isRequired ? <span className="ml-1 text-destructive">*</span> : null}
                      </div>
                      {fieldDescription ? (
                        <div className="text-xs text-muted-foreground">{fieldDescription}</div>
                      ) : null}
                      <ManualRepairFieldInput
                        property={property}
                        value={values[key]}
                        t={t as Translate}
                        onChange={(nextValue) =>
                          setValues((current) => ({
                            ...current,
                            [key]: nextValue,
                          }))
                        }
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="text-xs text-muted-foreground">
            {t('table:table.integrity.v2.manualRepairDialogHint')}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" onClick={() => void handleSubmit()} disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            {submitLabel}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            {t('table:table.integrity.v2.manualRepairDialogClose')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const getPreviewResults = (results: IntegrityResult[]) =>
  results.filter((result) => result.status !== 'running' && result.status !== 'pending');

const canPreviewRepairResult = (result: IntegrityResult) =>
  result.status === 'error' || result.status === 'warn' || result.status === 'skipped';

const getRuleRepairTooltipText = (
  t: Translate,
  result: IntegrityResult,
  canPreview: boolean,
  reason?: string,
  description?: string
) =>
  reason ||
  description ||
  (result.repair || canPreview
    ? t('table:table.integrity.v2.repairPreviewTooltip')
    : t('table:table.integrity.v2.repairUnavailable'));

const getRepairPreviewDisabledReason = (
  t: Translate,
  result: IntegrityResult,
  onPreviewRepairRule?: RepairRulePreviewHandler
) => {
  if (!canPreviewRepairResult(result)) {
    return t('table:table.integrity.v2.repairPreviewUnavailableStatus');
  }

  if (!onPreviewRepairRule) {
    return t('table:table.integrity.v2.repairUnavailable');
  }

  if (!result.tableId) {
    return t('table:table.integrity.v2.repairPreviewMissingTable');
  }

  return undefined;
};

const formatRepairParameters = (parameters?: ReadonlyArray<unknown>) => {
  if (!parameters?.length) {
    return undefined;
  }

  return JSON.stringify(parameters, null, 2);
};

const RepairRulePreviewDialog = ({
  result,
  open,
  dryRunResults,
  isSubmitting,
  canConfirm,
  onOpenChange,
  onConfirm,
}: {
  result: IntegrityResult;
  open: boolean;
  dryRunResults: IntegrityResult[];
  isSubmitting: boolean;
  canConfirm: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) => {
  const { t } = useTranslation(['table', 'common']);
  const previewResults = getPreviewResults(dryRunResults);
  const displayResults = previewResults.length ? previewResults : [result];
  const statements = displayResults.flatMap(
    (previewResult) => previewResult.details?.statements || []
  );
  const canExecute = canConfirm && statements.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[82vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>{t('table:table.integrity.v2.repairPreviewTitle')}</DialogTitle>
          <DialogDescription>
            {t('table:table.integrity.v2.repairPreviewDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
          {displayResults.map((previewResult) => {
            const localizedMessage = getLocalizedResultMessage(t as Translate, previewResult);
            const localizedRuleName = getLocalizedRuleDescription(t as Translate, previewResult);
            const repairReason = getLocalizedRepairReason(t as Translate, previewResult);
            const repairDescription = getLocalizedRepairDescription(t as Translate, previewResult);
            const localizedMissing = getLocalizedDetailItems(
              t as Translate,
              previewResult.details?.missingItems || previewResult.details?.missing
            );
            const localizedExtra = getLocalizedDetailItems(
              t as Translate,
              previewResult.details?.extraItems || previewResult.details?.extra
            );

            return (
              <div
                key={previewResult.id}
                className="rounded-lg border border-border bg-muted/20 p-4 text-sm"
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <StatusIcon status={previewResult.status} />
                  <span className="font-medium text-foreground">{localizedRuleName}</span>
                  <StatusBadge status={previewResult.status} />
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      {t('table:table.integrity.v2.repairPreviewWhat')}
                    </div>
                    <div className="mt-1 text-foreground">
                      {t('table:table.integrity.v2.repairPreviewTarget', {
                        fieldName: previewResult.fieldName,
                        ruleName: localizedRuleName,
                      })}
                    </div>
                    {localizedMessage ? (
                      <div className="mt-1 text-muted-foreground">{localizedMessage}</div>
                    ) : null}
                    {localizedMissing?.length ? (
                      <div className="mt-1 text-muted-foreground">
                        {t('table:table.integrity.v2.detailsMissing', {
                          details: localizedMissing.join(', '),
                        })}
                      </div>
                    ) : null}
                    {localizedExtra?.length ? (
                      <div className="mt-1 text-muted-foreground">
                        {t('table:table.integrity.v2.detailsExtra', {
                          details: localizedExtra.join(', '),
                        })}
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      {t('table:table.integrity.v2.repairPreviewPrinciple')}
                    </div>
                    <div className="mt-1 text-foreground">
                      {repairDescription ||
                        repairReason ||
                        t('table:table.integrity.v2.repairPreviewNoPrinciple')}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          <div className="rounded-lg border border-border bg-background p-4">
            <div className="mb-3 text-sm font-medium text-foreground">
              {t('table:table.integrity.v2.repairPreviewSql')}
            </div>
            {statements.length ? (
              <div className="space-y-3">
                {statements.map((statement, index) => {
                  const parameters = formatRepairParameters(statement.parameters);

                  return (
                    <div key={`${statement.sql}:${index}`} className="space-y-2">
                      <pre className="max-h-64 overflow-auto rounded-md bg-slate-950 p-3 text-xs leading-relaxed text-slate-50">
                        <code>{statement.sql}</code>
                      </pre>
                      {parameters ? (
                        <pre className="max-h-32 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
                          <code>
                            {t('table:table.integrity.v2.repairPreviewParameters')}
                            {': '}
                            {parameters}
                          </code>
                        </pre>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                {t('table:table.integrity.v2.repairPreviewNoSql')}
              </div>
            )}
          </div>

          {!canExecute ? (
            <Alert>
              <AlertDescription>
                {statements.length
                  ? t('table:table.integrity.v2.repairPreviewCannotConfirm')
                  : t('table:table.integrity.v2.repairPreviewNoSql')}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="button" onClick={onConfirm} disabled={isSubmitting || !canExecute}>
            {isSubmitting ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            {t('table:table.integrity.v2.repairPreviewConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const ManualRuleRepairAction = ({
  result,
  reason,
  description,
  onRepairRule,
}: {
  result: IntegrityResult;
  reason?: string;
  description?: string;
  onRepairRule: RepairRuleHandler;
}) => {
  const { t } = useTranslation(['table']);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <ManualRepairDialog
              result={result}
              triggerLabel={t('table:table.integrity.v2.manual')}
              onSubmit={onRepairRule}
            />
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs whitespace-normal">
          <div>{reason || t('table:table.integrity.v2.manualRepairNotice')}</div>
          {description ? <div className="mt-1 opacity-80">{description}</div> : null}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

const RuleRepairAction = ({
  result,
  isRunning,
  isActive,
  onRepairRule,
  onPreviewRepairRule,
}: {
  result: IntegrityResult;
  isRunning: boolean;
  isActive: boolean;
  onRepairRule?: RepairRuleHandler;
  onPreviewRepairRule?: RepairRulePreviewHandler;
}) => {
  const { t } = useTranslation(['table']);
  const previewDisabledReason = getRepairPreviewDisabledReason(
    t as Translate,
    result,
    onPreviewRepairRule
  );
  const canShowPreview = !previewDisabledReason;
  const canRepair = Boolean(
    result.repair?.available && result.tableId && result.fieldId && onRepairRule
  );
  const reason = getLocalizedRepairReason(t as Translate, result);
  const description = getLocalizedRepairDescription(t as Translate, result);
  const tooltipReason = getRuleRepairTooltipText(
    t as Translate,
    result,
    canShowPreview,
    reason,
    description
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [dryRunResults, setDryRunResults] = useState<IntegrityResult[]>([]);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const canConfirmRepair = canRepair || hasExecutableRepairStatements(dryRunResults);

  if (!canPreviewRepairResult(result) || (!onRepairRule && !onPreviewRepairRule)) {
    return null;
  }

  const handlePreview = async () => {
    if (!onPreviewRepairRule) {
      void onRepairRule?.(result);
      return;
    }

    setIsPreviewLoading(true);
    setDryRunResults([]);
    try {
      const nextDryRunResults = await onPreviewRepairRule(result);
      setDryRunResults(nextDryRunResults);
      setPreviewOpen(true);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!canConfirmRepair || !onRepairRule) {
      return;
    }

    setIsConfirming(true);
    try {
      const repaired = await onRepairRule(result);
      if (repaired) {
        setPreviewOpen(false);
      }
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <div className="ml-auto flex items-center gap-2 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
      {result.repair?.mode === 'manual' && onRepairRule ? (
        <ManualRuleRepairAction
          result={result}
          reason={reason}
          description={description}
          onRepairRule={onRepairRule}
        />
      ) : null}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button
                size="xs"
                variant="outline"
                className="h-7 px-2 text-xs"
                disabled={Boolean(previewDisabledReason) || isPreviewLoading}
                onClick={() => void handlePreview()}
              >
                {(isRunning && isActive) || isPreviewLoading ? (
                  <Loader2 className="mr-1 size-3.5 animate-spin" />
                ) : (
                  <Wrench className="mr-1 size-3.5" />
                )}
                {t('table:table.integrity.v2.repairRule')}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs whitespace-normal">
            <div>{previewDisabledReason || tooltipReason}</div>
            {!previewDisabledReason && reason && description ? (
              <div className="mt-1 opacity-80">{description}</div>
            ) : null}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <RepairRulePreviewDialog
        result={result}
        open={previewOpen}
        dryRunResults={dryRunResults}
        isSubmitting={isConfirming}
        canConfirm={canConfirmRepair}
        onOpenChange={setPreviewOpen}
        onConfirm={() => void handleConfirm()}
      />
    </div>
  );
};

const getUnavailableRepairGuidance = (
  result: IntegrityResult,
  reason?: string,
  description?: string
) => {
  const show =
    result.status !== 'success' &&
    Boolean(result.repair) &&
    result.repair?.available === false &&
    result.repair?.mode === 'auto' &&
    Boolean(reason || description);

  return {
    show,
    reason,
    description,
  };
};

const UnavailableRepairGuidance = ({
  reason,
  description,
}: {
  reason?: string;
  description?: string;
}) => {
  if (!reason && !description) {
    return null;
  }

  return (
    <div className="mt-2 rounded-md border border-amber-200/70 bg-amber-50/80 px-3 py-2 text-[13px] text-amber-950">
      {reason ? <div className="font-medium">{reason}</div> : null}
      {description ? (
        <div className={cn(reason ? 'mt-1 text-amber-900/90' : 'text-amber-900/90')}>
          {description}
        </div>
      ) : null}
    </div>
  );
};

const RuleResultItem = ({
  result,
  isRunning,
  isActive,
  onRepairRule,
  onPreviewRepairRule,
}: {
  result: IntegrityResult;
  isRunning: boolean;
  isActive: boolean;
  onRepairRule?: RepairRuleHandler;
  onPreviewRepairRule?: RepairRulePreviewHandler;
}) => {
  const { t } = useTranslation(['table']);
  const localizedMessage = getLocalizedResultMessage(t as Translate, result);
  const shouldShowMessage = localizedMessage && result.status !== 'success';
  const repairReason = getLocalizedRepairReason(t as Translate, result);
  const repairDescription = getLocalizedRepairDescription(t as Translate, result);
  const unavailableRepairGuidance = getUnavailableRepairGuidance(
    result,
    repairReason,
    repairDescription
  );
  const localizedMissing = getLocalizedDetailItems(
    t as Translate,
    result.details?.missingItems || result.details?.missing
  );
  const localizedExtra = getLocalizedDetailItems(
    t as Translate,
    result.details?.extraItems || result.details?.extra
  );

  return (
    <div className="group py-3 text-sm">
      <div className="flex flex-wrap items-start gap-2">
        <StatusIcon status={result.status} />
        <span className="font-medium text-foreground">
          {getLocalizedRuleDescription(t as Translate, result)}
        </span>
        <StatusBadge status={result.status} />
        <OutcomeBadge result={result} />
        {!result.required ? (
          <Badge
            variant="outline"
            className="h-5 border-border px-1.5 text-[10px] font-normal uppercase text-muted-foreground"
          >
            {t('table:table.integrity.v2.optional')}
          </Badge>
        ) : null}
        <RuleRepairAction
          result={result}
          isRunning={isRunning}
          isActive={isActive}
          onRepairRule={onRepairRule}
          onPreviewRepairRule={onPreviewRepairRule}
        />
      </div>
      {shouldShowMessage ? (
        <div className="mt-2 text-muted-foreground">{localizedMessage}</div>
      ) : null}
      {unavailableRepairGuidance.show ? (
        <UnavailableRepairGuidance
          reason={unavailableRepairGuidance.reason}
          description={unavailableRepairGuidance.description}
        />
      ) : null}
      {localizedMissing?.length ? (
        <div className="mt-2 text-muted-foreground">
          {t('table:table.integrity.v2.detailsMissing', {
            details: localizedMissing.join(', '),
          })}
        </div>
      ) : null}
      {localizedExtra?.length ? (
        <div className="mt-1 text-muted-foreground">
          {t('table:table.integrity.v2.detailsExtra', {
            details: localizedExtra.join(', '),
          })}
        </div>
      ) : null}
      {result.details?.statementCount ? (
        <div className="mt-1 text-muted-foreground">
          {t('table:table.integrity.v2.statementCount', {
            count: result.details.statementCount,
          })}
        </div>
      ) : null}
    </div>
  );
};

export const SummaryBadges = ({
  summary,
  phase,
  baseId,
  baseName,
  tableId,
  tableName,
}: {
  summary: IntegritySummary;
  phase: IntegrityPhase;
  baseId?: string;
  baseName?: string;
  tableId?: string;
  tableName?: string;
}) => {
  const { t } = useTranslation(['table']);
  const targetLabel = tableId ? tableName || tableId : baseName || baseId;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{getPhaseText(t as Translate, phase, 'badge')}</Badge>
        {targetLabel ? (
          <Badge variant="outline" className="font-mono text-xs">
            {targetLabel}
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span>{t('table:table.integrity.v2.summary.checks', { count: summary.total })}</span>
        <span>{t('table:table.integrity.v2.summary.problems', { count: summary.issueCount })}</span>
        {summary.repaired > 0 ? (
          <span>{t('table:table.integrity.v2.summary.repaired', { count: summary.repaired })}</span>
        ) : null}
        {summary.manual > 0 ? (
          <span>{t('table:table.integrity.v2.summary.manual', { count: summary.manual })}</span>
        ) : null}
      </div>
    </div>
  );
};

const filterChipClasses: Record<IntegrityFilterStatus, string> = {
  success:
    'data-[state=on]:border-green-300 data-[state=on]:bg-green-50 data-[state=on]:text-green-700 data-[state=on]:shadow-sm',
  warn: 'data-[state=on]:border-amber-300 data-[state=on]:bg-amber-50 data-[state=on]:text-amber-700 data-[state=on]:shadow-sm',
  error:
    'data-[state=on]:border-destructive/30 data-[state=on]:bg-destructive/10 data-[state=on]:text-destructive data-[state=on]:shadow-sm',
  skipped:
    'data-[state=on]:border-slate-300 data-[state=on]:bg-slate-100 data-[state=on]:text-slate-700 data-[state=on]:shadow-sm',
};

export const IntegrityStatusFilters = ({
  summary,
  phase,
  selectedStatuses,
  onStatusesChange,
}: {
  summary: IntegritySummary;
  phase: IntegrityPhase;
  selectedStatuses: IntegrityFilterStatus[];
  onStatusesChange: (statuses: IntegrityFilterStatus[]) => void;
}) => {
  const { t } = useTranslation(['table']);
  const visibleStatuses = integrityFilterStatuses.filter((status) => {
    return status !== 'skipped' || phase === 'repair' || summary.skipped > 0;
  });

  const statusCounts: Record<IntegrityFilterStatus, number> = {
    success: summary.success,
    warn: summary.warn,
    error: summary.error,
    skipped: summary.skipped,
  };

  return (
    <ToggleGroup
      type="multiple"
      variant="outline"
      size="sm"
      value={selectedStatuses}
      onValueChange={(value) => onStatusesChange(value as IntegrityFilterStatus[])}
      className="flex flex-wrap justify-start gap-2"
    >
      {visibleStatuses.map((status) => (
        <ToggleGroupItem
          key={status}
          value={status}
          className={cn(
            'h-9 rounded-full border border-slate-200 bg-white px-3 text-sm font-medium text-slate-500 shadow-none transition-colors hover:bg-slate-50 hover:text-slate-700 data-[state=off]:bg-white data-[state=off]:text-slate-500',
            filterChipClasses[status]
          )}
        >
          {t(`table:table.integrity.v2.summary.${status}`, {
            count: statusCounts[status],
          })}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
};

export const IntegrityActions = ({
  canRun,
  hasRun,
  canRepairWarnings,
  canRepairAny,
  isRunning,
  phase,
  onCheck,
  onRepair,
}: {
  canRun: boolean;
  hasRun: boolean;
  canRepairWarnings: boolean;
  canRepairAny: boolean;
  isRunning: boolean;
  phase: IntegrityPhase;
  onCheck: () => void;
  onRepair: (targetStatuses: Array<'warn' | 'error'>) => void;
}) => {
  const { t } = useTranslation(['table']);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={onCheck} disabled={!canRun || isRunning}>
        {isRunning && phase === 'check' ? (
          <Loader2 className="mr-2 size-4 animate-spin" />
        ) : (
          <RefreshCcw className="mr-2 size-4" />
        )}
        {hasRun ? t('table:table.integrity.v2.recheck') : t('table:table.integrity.v2.runCheck')}
      </Button>
      <div className="inline-flex items-center">
        <Button
          size="sm"
          onClick={() => onRepair(['warn'])}
          disabled={!canRepairWarnings || isRunning}
          className="rounded-r-none border-r-0"
        >
          {isRunning && phase === 'repair' ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Wrench className="mr-2 size-4" />
          )}
          {t('table:table.integrity.v2.repair')}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="default"
              disabled={!canRepairAny || isRunning}
              className="rounded-l-none px-2"
            >
              <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem disabled={!canRepairWarnings} onClick={() => onRepair(['warn'])}>
              {t('table:table.integrity.v2.repairWarnings')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canRepairAny} onClick={() => onRepair(['warn', 'error'])}>
              {t('table:table.integrity.v2.repairWarningsAndErrors')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {isRunning ? (
        <span className="text-sm text-muted-foreground">
          {getPhaseText(t as Translate, phase, 'running')}
        </span>
      ) : null}
    </div>
  );
};

const GroupStateIcon = ({ displayState }: { displayState: GroupDisplayState }) => {
  if (displayState.hasError) {
    return <XCircle className="size-4 text-destructive" />;
  }

  if (displayState.hasWarn) {
    return <AlertTriangle className="size-4 text-yellow-500" />;
  }

  if (displayState.allSuccess) {
    return <CheckCircle2 className="size-4 text-green-500" />;
  }

  return <Loader2 className="size-4 animate-spin text-blue-500" />;
};

const HeaderTypeIcon = ({
  type,
  icon: Icon,
}: {
  type: 'table' | 'field';
  icon?: ComponentType<{ className?: string }>;
}) => {
  if (type === 'table') {
    return (
      <span className="inline-flex size-8 items-center justify-center rounded-lg border border-slate-300/70 bg-white/80 text-slate-700 shadow-sm">
        <Table2 className="size-[18px]" />
      </span>
    );
  }

  const FieldIcon = Icon ?? Columns3;

  return (
    <span className="inline-flex size-7 items-center justify-center rounded-md border border-slate-200 bg-white/75 text-slate-600">
      <FieldIcon className="size-4" />
    </span>
  );
};

const ManualRepairNotice = ({ count }: { count: number }) => {
  const { t } = useTranslation(['table']);

  if (count <= 0) {
    return null;
  }

  return (
    <Alert className="border-amber-200 bg-amber-50/70 text-amber-950">
      <AlertDescription>
        {t('table:table.integrity.v2.manualRepairNoticeWithCount', {
          count,
        })}
      </AlertDescription>
    </Alert>
  );
};

const IntegrityGroupCard = ({
  group,
  isRunning,
  activeRepairResultId,
  onRepairRule,
  onPreviewRepairRule,
  nested = false,
}: {
  group: ResultGroup;
  isRunning: boolean;
  activeRepairResultId?: string | null;
  onRepairRule?: RepairRuleHandler;
  onPreviewRepairRule?: RepairRulePreviewHandler;
  nested?: boolean;
}) => {
  const { t } = useTranslation(['table']);
  const fieldStaticGetter = useFieldStaticGetter();
  const displayState = getGroupDisplayState(group.results);
  const displayName = getGroupDisplayName(t as Translate, group);
  const fieldIcon = useMemo(() => {
    const iconConfig = inferFieldTypeFromGroup(group);

    if (!iconConfig) {
      return undefined;
    }

    return fieldStaticGetter(iconConfig.type, {
      isLookup: iconConfig.isLookup,
      isConditionalLookup: iconConfig.isConditionalLookup,
    }).Icon;
  }, [fieldStaticGetter, group]);

  return (
    <section className={cn(!nested && 'rounded-xl border border-border bg-background')}>
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3',
          nested ? 'bg-slate-50/70' : 'bg-slate-50/85'
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <HeaderTypeIcon type="field" icon={fieldIcon} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900">{displayName}</div>
            {group.fieldId &&
            group.fieldId !== '__system__' &&
            !group.fieldId.startsWith('__system__:') ? (
              <div className="truncate font-mono text-xs text-slate-500">{group.fieldId}</div>
            ) : null}
          </div>
        </div>
        <GroupStateIcon displayState={displayState} />
      </div>

      <div className="divide-y divide-border px-4">
        {group.results.map((result) => (
          <RuleResultItem
            key={result.id}
            result={result}
            isRunning={isRunning}
            isActive={activeRepairResultId === result.id}
            onRepairRule={onRepairRule}
            onPreviewRepairRule={onPreviewRepairRule}
          />
        ))}
      </div>
    </section>
  );
};

const IntegrityTableCard = ({
  group,
  baseId,
  isRunning,
  activeRepairResultId,
  onRepairRule,
  onPreviewRepairRule,
}: {
  group: TableResultGroup;
  baseId?: string;
  isRunning: boolean;
  activeRepairResultId?: string | null;
  onRepairRule?: RepairRuleHandler;
  onPreviewRepairRule?: RepairRulePreviewHandler;
}) => {
  const displayState = getGroupDisplayState(group.results);
  const tableHref =
    (group.baseId || baseId) && group.tableId
      ? `/base/${group.baseId || baseId}/table/${group.tableId}`
      : undefined;
  const tableLabel = group.tableName || group.tableId;

  return (
    <section className="rounded-xl border border-border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-100/90 px-4 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <HeaderTypeIcon type="table" />
          <div className="min-w-0">
            {tableHref ? (
              <Link
                href={tableHref}
                className="inline-flex max-w-full items-center gap-1.5 text-sm font-semibold text-slate-950 underline-offset-4 hover:text-primary hover:underline"
              >
                <span className="truncate">{tableLabel}</span>
                <ExternalLink className="size-3.5 shrink-0 text-slate-500" />
              </Link>
            ) : (
              <div className="truncate text-sm font-semibold text-slate-950">{tableLabel}</div>
            )}
            {group.tableId ? (
              <div className="truncate font-mono text-xs text-slate-500">{group.tableId}</div>
            ) : null}
          </div>
        </div>
        <GroupStateIcon displayState={displayState} />
      </div>

      <div className="divide-y divide-border">
        {group.groups.map((fieldGroup) => (
          <IntegrityGroupCard
            key={`${group.tableId}:${fieldGroup.fieldId || '__general__'}`}
            group={fieldGroup}
            isRunning={isRunning}
            activeRepairResultId={activeRepairResultId}
            onRepairRule={onRepairRule}
            onPreviewRepairRule={onPreviewRepairRule}
            nested
          />
        ))}
      </div>
    </section>
  );
};

export const IntegrityResultsPanel = ({
  scope,
  baseId,
  tableGroups,
  groupedResults,
  hasRun,
  isRunning,
  phase,
  hasTarget,
  hasFilteredOutAll,
  activeRepairResultId,
  onRepairRule,
  onPreviewRepairRule,
}: {
  scope: IntegrityScope;
  baseId?: string;
  tableGroups: TableResultGroup[];
  groupedResults: ResultGroup[];
  hasRun: boolean;
  isRunning: boolean;
  phase: IntegrityPhase;
  hasTarget: boolean;
  hasFilteredOutAll: boolean;
  activeRepairResultId?: string | null;
  onRepairRule?: RepairRuleHandler;
  onPreviewRepairRule?: RepairRulePreviewHandler;
}) => {
  const { t } = useTranslation(['table']);
  const runningText = getPhaseText(t as Translate, phase, 'running');
  const currentResults =
    scope === 'base'
      ? tableGroups.flatMap((group) => group.results)
      : groupedResults.flatMap((group) => group.results);
  const manualRepairCount = currentResults.filter(
    (result) => result.repair?.mode === 'manual'
  ).length;

  if (!hasTarget) {
    return (
      <div className="flex h-full min-h-48 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        {t('table:table.integrity.v2.noTableSelected')}
      </div>
    );
  }

  if (!hasRun && !isRunning) {
    return (
      <div className="flex h-full min-h-48 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        {t('table:table.integrity.v2.noResults')}
      </div>
    );
  }

  const hasResults = scope === 'base' ? tableGroups.length > 0 : groupedResults.length > 0;

  if (!hasResults) {
    return (
      <div className="flex h-full min-h-48 items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground">
        {isRunning ? <Loader2 className="size-4 animate-spin" /> : null}
        {isRunning
          ? runningText
          : hasFilteredOutAll
            ? t('table:table.integrity.v2.noFilteredResults')
            : t('table:table.integrity.v2.noResults')}
      </div>
    );
  }

  if (scope === 'base') {
    return (
      <div className="space-y-4">
        <ManualRepairNotice count={manualRepairCount} />
        {tableGroups.map((group) => (
          <IntegrityTableCard
            key={group.tableId || group.tableName}
            group={group}
            baseId={baseId}
            isRunning={isRunning}
            activeRepairResultId={activeRepairResultId}
            onRepairRule={onRepairRule}
            onPreviewRepairRule={onPreviewRepairRule}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ManualRepairNotice count={manualRepairCount} />
      <section className="overflow-hidden rounded-xl border border-border bg-background">
        <div className="divide-y divide-border">
          {groupedResults.map((group) => (
            <IntegrityGroupCard
              key={group.fieldId || '__general__'}
              group={group}
              isRunning={isRunning}
              activeRepairResultId={activeRepairResultId}
              onRepairRule={onRepairRule}
              onPreviewRepairRule={onPreviewRepairRule}
              nested
            />
          ))}
        </div>
      </section>
    </div>
  );
};
