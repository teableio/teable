import { sqlText, type FormulaCompileBudget } from './FormulaCompileBudget';

export const buildUserSnapshotObjectSql = (
  snapshotRef: string,
  budget?: FormulaCompileBudget
): string => {
  const text = budget?.sql ?? sqlText;
  const snapshotJson = text`to_jsonb(${snapshotRef})`;
  const scalarText = text`(${snapshotJson} #>> '{}')`;
  return text`(CASE
    WHEN ${snapshotRef} IS NULL THEN NULL::jsonb
    WHEN jsonb_typeof(${snapshotJson}) = 'object' THEN ${snapshotJson}
    ELSE jsonb_build_object('id', ${scalarText}, 'title', ${scalarText})
  END)`;
};

export const buildUserTitleFromSnapshotSql = (
  snapshotRef: string,
  idFallbackRef?: string,
  budget?: FormulaCompileBudget
): string => {
  const text = budget?.sql ?? sqlText;
  const snapshotObject = buildUserSnapshotObjectSql(snapshotRef, budget);
  const fallback = idFallbackRef ?? text`${snapshotObject}->>'id'`;
  return text`COALESCE(${snapshotObject}->>'title', ${snapshotObject}->>'name', ${snapshotObject}->>'id', ${fallback})`;
};
