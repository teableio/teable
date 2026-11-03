import { Button } from '@teable/ui-lib/shadcn';
import type { IOperationPreviewDto } from '@teable/v2-contract-http/operationPreview';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { buildPreviewPresentation } from './operationPreviewPresentation';
import type {
  ConsequenceSummary,
  CopySummary,
  PreviewMeasure,
  PreviewPresentation,
} from './operationPreviewPresentation';

const hasQuantityValue = (
  measure: PreviewMeasure
): measure is Exclude<PreviewMeasure, { basis: 'unknown' }> =>
  measure.basis !== 'unknown' &&
  (measure.basis !== 'range' ||
    measure.lower != null ||
    measure.expected != null ||
    measure.upper != null);

const Quantity = ({ measure }: { measure: PreviewMeasure }) => {
  const { t, i18n } = useTranslation('common');
  const number = (value: number) => value.toLocaleString(i18n.language);
  if (!hasQuantityValue(measure)) {
    return <>{t('operationPreview.quantity.unknown')}</>;
  }
  if (measure.basis !== 'range') {
    const value = number(measure.value);
    return (
      <>
        {measure.basis === 'estimate' ? t('operationPreview.quantity.estimate', { value }) : value}
      </>
    );
  }
  const { lower, expected, upper } = measure;
  const bounds =
    lower != null && upper != null
      ? t('operationPreview.quantity.range', { lower: number(lower), upper: number(upper) })
      : lower != null
        ? t('operationPreview.quantity.atLeast', { value: number(lower) })
        : upper != null
          ? t('operationPreview.quantity.atMost', { value: number(upper) })
          : null;
  return (
    <>
      {bounds}
      {bounds && expected != null ? ' · ' : null}
      {expected != null
        ? t('operationPreview.quantity.expected', { value: number(expected) })
        : null}
    </>
  );
};

const ResourceNames = ({ names }: { names: string[] }) =>
  names.length > 0 ? <p className="break-words">{names.join(', ')}</p> : null;

const CopyDetails = ({
  copy,
  operation,
}: {
  copy: CopySummary;
  operation: IOperationPreviewDto['operation'];
}) => {
  const { t } = useTranslation('common');
  const source =
    copy.names.length > 0
      ? t('operationPreview.copySource', { names: copy.names.join(', ') })
      : t(
          `operationPreview.${operation === 'base.duplicate' ? 'copyBaseTitle' : 'copyTableTitle'}`
        );
  return (
    <div className="space-y-1 rounded-md bg-muted/50 p-3">
      <h3 className="break-words font-semibold">{source}</h3>
      <p>{t(`operationPreview.${copy.heading}`)}</p>
      {copy.quantities.length > 0 ? (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-muted-foreground">
          {copy.quantities.map((quantity) => (
            <div key={quantity.label} className="flex items-baseline gap-1.5">
              <dt>{t(`operationPreview.labels.${quantity.label}`)}</dt>
              <dd className="font-medium tabular-nums text-foreground">
                <Quantity measure={quantity.measure} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
};

const BlockerDetails = ({ blockers }: { blockers: PreviewPresentation['blockers'] }) => {
  const { t } = useTranslation('common');
  if (blockers.length === 0) return null;
  return (
    <div
      role="alert"
      className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3"
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 space-y-2">
        <h4 className="font-medium text-destructive">{t('operationPreview.blockedTitle')}</h4>
        {blockers.map((blocker) => (
          <div key={blocker.message} className="space-y-1">
            <p>{t(`operationPreview.messages.${blocker.message}`)}</p>
            <ResourceNames names={blocker.names} />
          </div>
        ))}
      </div>
    </div>
  );
};

const ConsequenceDetails = ({ consequence }: { consequence: ConsequenceSummary }) => {
  const { t } = useTranslation('common');
  const hasMeasure = Boolean(consequence.fields || consequence.views);
  return (
    <li className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-x-4 gap-y-1 py-2">
      <div className="min-w-0 space-y-1">
        <ResourceNames names={consequence.names} />
        {consequence.tables.length > 0 ? (
          <p className="break-words text-muted-foreground">
            {t('operationPreview.inTables', { names: consequence.tables.join(', ') })}
          </p>
        ) : null}
        {(['fields', 'views'] as const).map((label) => {
          const measure = consequence[label];
          if (
            !measure ||
            (measure.basis === 'exact' &&
              consequence.names.length > 0 &&
              measure.value <= consequence.names.length)
          )
            return null;
          return (
            <p key={label} className="text-muted-foreground">
              {t(`operationPreview.${label === 'fields' ? 'affectedFields' : 'affectedViews'}`)}{' '}
              <span className="tabular-nums">
                <Quantity measure={measure} />
              </span>
            </p>
          );
        })}
        {consequence.names.length === 0 && consequence.tables.length === 0 && !hasMeasure ? (
          <p className="text-muted-foreground">
            {t(
              `operationPreview.labels.${consequence.message === 'fieldViewsChangedDetail' ? 'views' : 'fields'}`
            )}
          </p>
        ) : null}
      </div>
      <p className="min-w-0 break-words font-medium">
        {t(`operationPreview.messages.${consequence.message}`)}
      </p>
    </li>
  );
};

const ConsequenceGroup = ({
  consequences,
  preserved = false,
}: {
  consequences: ConsequenceSummary[];
  preserved?: boolean;
}) => {
  const { t } = useTranslation('common');
  if (consequences.length === 0) return null;
  return (
    <div className="space-y-2 border-t pt-3">
      <h4 className="text-xs font-medium text-muted-foreground">
        {t(`operationPreview.${preserved ? 'preservedTitle' : 'changedEffectsTitle'}`)}
      </h4>
      <ul className="divide-y">
        {consequences.map((consequence) => (
          <ConsequenceDetails key={consequence.key} consequence={consequence} />
        ))}
      </ul>
    </div>
  );
};

const ActionDetails = ({
  summary,
  operation,
  targetFieldName,
}: {
  summary: PreviewPresentation;
  operation: IOperationPreviewDto['operation'];
  targetFieldName?: string;
}) => {
  const { t } = useTranslation('common');
  const fieldDeletion = summary.consequences.find(
    (consequence) => consequence.message === 'fieldDeleted'
  );
  if (summary.copy) return <CopyDetails copy={summary.copy} operation={operation} />;
  if (summary.deletion) {
    return (
      <div className="space-y-1 rounded-md bg-muted/50 p-3">
        <h3 className="break-words font-semibold">
          {summary.deletion.names.join(', ') || t('operationPreview.deleteTableTitle')}
        </h3>
        <p>{t(`operationPreview.${summary.deletion.message}`)}</p>
      </div>
    );
  }
  if (fieldDeletion) {
    return (
      <div className="space-y-1 rounded-md bg-muted/50 p-3">
        <h3 className="break-words font-semibold">
          {fieldDeletion.names.join(', ') ||
            targetFieldName ||
            t('operationPreview.deleteFieldTitle')}
        </h3>
        <p>{t('operationPreview.messages.fieldDeleted')}</p>
      </div>
    );
  }
  const title =
    operation === 'field.delete'
      ? 'deleteFieldTitle'
      : operation === 'table.delete'
        ? 'deleteTableTitle'
        : operation === 'table.duplicate'
          ? 'copyTableTitle'
          : operation === 'base.duplicate'
            ? 'copyBaseTitle'
            : 'title';
  return (
    <div className="space-y-1 rounded-md bg-muted/50 p-3">
      <h3 className="font-semibold">{t(`operationPreview.${title}`)}</h3>
      {summary.consequences.length === 0 && summary.blockers.length === 0 ? (
        <p className="text-muted-foreground">{t('operationPreview.emptyEffects')}</p>
      ) : null}
    </div>
  );
};

const UnknownDetails = ({ summary }: { summary: PreviewPresentation }) => {
  const { t } = useTranslation('common');
  const scopes = summary.coverage
    .filter((message) => message !== 'retentionUnknown' && message !== 'storageUnknown')
    .map((message) => t(`operationPreview.${message}`));
  const retentionUnknown = summary.coverage.includes('retentionUnknown');
  const storageUnknown = summary.coverage.includes('storageUnknown');
  const coverageNotes = [
    ...(scopes.length > 0
      ? [
          t('operationPreview.coverageUnknown', {
            scopes: scopes.join(t('operationPreview.coverageSeparator')),
          }),
        ]
      : []),
    ...(retentionUnknown || storageUnknown
      ? [
          t(
            `operationPreview.${
              retentionUnknown && storageUnknown
                ? 'retentionStorageUnknown'
                : retentionUnknown
                  ? 'retentionUnknown'
                  : 'storageUnknown'
            }`
          ),
        ]
      : []),
  ];
  if (coverageNotes.length === 0 && summary.warnings.length === 0 && !summary.hiddenDependencies)
    return null;
  return (
    <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
      {summary.hiddenDependencies ? <p>{t('operationPreview.relatedUnknown')}</p> : null}
      {summary.warnings.map((message) => (
        <p key={message}>{t(`operationPreview.messages.${message}`)}</p>
      ))}
      {coverageNotes.length > 0 ? (
        <details>
          <summary className="cursor-pointer rounded-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t('operationPreview.coverageTitle')}
          </summary>
          <ul className="mt-2 space-y-1">
            {coverageNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
};

const PreviewDetails = ({
  preview,
  targetFieldName,
}: {
  preview: IOperationPreviewDto;
  targetFieldName?: string;
}) => {
  const { t } = useTranslation('common');
  const summary = buildPreviewPresentation(preview);
  const changes = summary.consequences.filter(
    (consequence) => !consequence.preserved && consequence.message !== 'fieldDeleted'
  );
  const preserved = summary.consequences.filter((consequence) => consequence.preserved);
  return (
    <section
      // Scrollable regions need focus so keyboard users can reach content below the fold.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      className="max-h-80 space-y-3 overflow-y-auto rounded text-sm leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      aria-label={t('operationPreview.title')}
    >
      <ActionDetails
        summary={summary}
        operation={preview.operation}
        targetFieldName={preview.operation === 'field.delete' ? targetFieldName : undefined}
      />
      <BlockerDetails blockers={summary.blockers} />
      <ConsequenceGroup consequences={changes} />
      <ConsequenceGroup consequences={preserved} preserved />
      <UnknownDetails summary={summary} />
    </section>
  );
};

export interface OperationPreviewPanelProps {
  preview?: IOperationPreviewDto;
  /** Already-authorized target name from the invoking field dialog, never a dependency name. */
  targetFieldName?: string;
  error?: unknown;
  isLoading: boolean;
  onRetry: () => void;
}

/** Product consequences only; the canonical DTO retains the machine-readable evidence. */
export const OperationPreviewPanel = ({
  preview,
  error,
  isLoading,
  onRetry,
  targetFieldName,
}: OperationPreviewPanelProps) => {
  const { t } = useTranslation('common');
  if (isLoading) {
    return (
      <p role="status" className="py-2 text-sm text-muted-foreground">
        {t('operationPreview.loading')}
      </p>
    );
  }
  if (error || !preview) {
    return (
      <div role="alert" className="space-y-2 rounded-md border border-destructive p-3 text-sm">
        <p>{t('operationPreview.failed')}</p>
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          {t('actions.retry')}
        </Button>
      </div>
    );
  }
  return <PreviewDetails preview={preview} targetFieldName={targetFieldName} />;
};
