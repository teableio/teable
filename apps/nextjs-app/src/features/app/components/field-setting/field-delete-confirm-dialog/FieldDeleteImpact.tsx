export type IFieldDeleteImpactProps = {
  open?: boolean;
  tableId: string;
  fieldIds: string[];
  fieldNames?: Record<string, string>;
};

/**
 * Community default: the query dependency index is an enterprise feature, so
 * the community build shows no App impact section.
 */
export const FieldDeleteImpact = (_props: IFieldDeleteImpactProps) => null;
