import type { IExecutionContext } from '../../ports/ExecutionContext';

const linkTextBatch = Symbol('linkTextBatch');
type BatchContext = IExecutionContext & {
  readonly [linkTextBatch]?: {
    readonly links: ReadonlySet<string>;
    readonly fields: ReadonlySet<string>;
  };
};

/** Internal command scope; no public field-update input can request this policy. */
export const withLinkTextConversionBatch = (
  context: IExecutionContext,
  fields: ReadonlyArray<{ tableId: string; fieldId: string }>,
  allFields: ReadonlySet<string>
): IExecutionContext => {
  const batchContext: BatchContext = {
    ...context,
    [linkTextBatch]: {
      links: new Set(fields.map(({ tableId, fieldId }) => `${tableId}:${fieldId}`)),
      fields: allFields,
    },
  };
  return batchContext;
};

export const isLinkTextConversionBatchField = (
  context: IExecutionContext | undefined,
  tableId: string,
  fieldId: string
): boolean =>
  (context as BatchContext | undefined)?.[linkTextBatch]?.links.has(`${tableId}:${fieldId}`) ===
  true;

export const isCompoundLinkTextConversionField = (
  context: IExecutionContext,
  tableId: string,
  fieldId: string
): boolean =>
  (context as BatchContext)[linkTextBatch]?.fields.has(`${tableId}:${fieldId}`) === true;
