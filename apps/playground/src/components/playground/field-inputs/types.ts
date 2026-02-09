import type { Field } from '@teable/v2-core';
import type { V2HttpClient } from '@/lib/orpc/OrpcClientContext';

export interface FieldInputProps {
  field: Field;
  value: unknown;
  onChange: (value: unknown) => void;
  onBlur: () => void;
  disabled?: boolean;
  /** ORPC client for fetching related data (e.g., link field records) */
  orpcClient?: V2HttpClient;
  /** Base ID for constructing navigation links (e.g., link field foreign table) */
  baseId?: string;
}
