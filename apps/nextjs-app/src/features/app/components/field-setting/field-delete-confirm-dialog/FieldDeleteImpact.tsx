import type { IFieldRo } from '@teable/core';
import type { IOperationPreviewDto } from '@teable/v2-contract-http/operationPreview';

export type IFieldDeleteImpactProps = {
  open?: boolean;
  tableId: string;
  fieldIds: string[];
  fieldNames?: Record<string, string>;
  /** Exact conversion candidate; absent for deletion. */
  fieldRo?: IFieldRo;
  /** Parent-owned mount outside its scroll body; null during SSR/first render. */
  confirmationContainer?: HTMLElement | null;
  /** Parent-owned canonical result: this presentation never fetches its own candidate. */
  preview: {
    data?: IOperationPreviewDto;
    pending: boolean;
    error: unknown;
    refetch: () => unknown;
    updatedAt: number;
  };
  onReadyChange?: (ready: boolean) => void;
};

/**
 * Community default: the query dependency index is an enterprise feature, so
 * the community build shows no App impact section.
 */
export const FieldDeleteImpact = (_props: IFieldDeleteImpactProps) => null;

export const useFieldImpactConfirmation = () => false;
