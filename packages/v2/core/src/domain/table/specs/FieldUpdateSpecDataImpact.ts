import type { ISpecification } from '../../shared/specification/ISpecification';
import type { Table } from '../Table';
import type { ITableSpecVisitor } from './ITableSpecVisitor';
import { UpdateButtonColorSpec } from './field-updates/UpdateButtonColorSpec';
import { UpdateButtonLabelSpec } from './field-updates/UpdateButtonLabelSpec';
import { UpdateButtonMaxCountSpec } from './field-updates/UpdateButtonMaxCountSpec';
import { UpdateButtonResetCountSpec } from './field-updates/UpdateButtonResetCountSpec';
import { UpdateCheckboxDefaultValueSpec } from './field-updates/UpdateCheckboxDefaultValueSpec';
import { UpdateDateDefaultValueSpec } from './field-updates/UpdateDateDefaultValueSpec';
import { UpdateDateFormattingSpec } from './field-updates/UpdateDateFormattingSpec';
import { UpdateFormulaFormattingSpec } from './field-updates/UpdateFormulaFormattingSpec';
import { UpdateFormulaShowAsSpec } from './field-updates/UpdateFormulaShowAsSpec';
import { UpdateLongTextDefaultValueSpec } from './field-updates/UpdateLongTextDefaultValueSpec';
import { UpdateLongTextShowAsSpec } from './field-updates/UpdateLongTextShowAsSpec';
import { UpdateMultipleSelectAutoNewOptionsSpec } from './field-updates/UpdateMultipleSelectAutoNewOptionsSpec';
import { UpdateMultipleSelectDefaultValueSpec } from './field-updates/UpdateMultipleSelectDefaultValueSpec';
import { UpdateNumberDefaultValueSpec } from './field-updates/UpdateNumberDefaultValueSpec';
import { UpdateNumberFormattingSpec } from './field-updates/UpdateNumberFormattingSpec';
import { UpdateNumberShowAsSpec } from './field-updates/UpdateNumberShowAsSpec';
import { UpdateRatingColorSpec } from './field-updates/UpdateRatingColorSpec';
import { UpdateRatingIconSpec } from './field-updates/UpdateRatingIconSpec';
import { UpdateRatingMaxSpec } from './field-updates/UpdateRatingMaxSpec';
import { UpdateRollupFormattingSpec } from './field-updates/UpdateRollupFormattingSpec';
import { UpdateRollupShowAsSpec } from './field-updates/UpdateRollupShowAsSpec';
import { UpdateSingleLineTextDefaultValueSpec } from './field-updates/UpdateSingleLineTextDefaultValueSpec';
import { UpdateSingleLineTextShowAsSpec } from './field-updates/UpdateSingleLineTextShowAsSpec';
import { UpdateSingleSelectAutoNewOptionsSpec } from './field-updates/UpdateSingleSelectAutoNewOptionsSpec';
import { UpdateSingleSelectDefaultValueSpec } from './field-updates/UpdateSingleSelectDefaultValueSpec';
import { UpdateUserDefaultValueSpec } from './field-updates/UpdateUserDefaultValueSpec';
import { UpdateUserNotificationSpec } from './field-updates/UpdateUserNotificationSpec';
import { TableUpdateFieldAiConfigSpec } from './TableUpdateFieldAiConfigSpec';
import { TableUpdateFieldDbFieldNameSpec } from './TableUpdateFieldDbFieldNameSpec';
import { TableUpdateFieldDescriptionSpec } from './TableUpdateFieldDescriptionSpec';
import { TableUpdateFieldHasErrorSpec } from './TableUpdateFieldHasErrorSpec';
import { TableUpdateFieldNameSpec } from './TableUpdateFieldNameSpec';

/**
 * Field-update specs that never rewrite existing cell data when applied.
 *
 * These cover pure metadata (name/description/aiConfig/dbFieldName), display
 * concerns (showAs/formatting), default values for future cells, and button or
 * rating presentation. Anything not listed — type conversion, formula/rollup
 * expression or timeZone, select choices, link config, constraints, user
 * multiplicity, etc. — may rewrite or invalidate stored cells and is therefore
 * treated as data-affecting. Unknown specs default to data-affecting so new
 * spec types fail safe (a confirmation may be shown) rather than silently
 * skipping a real rewrite.
 */
const nonDataAffectingSpecClasses = [
  TableUpdateFieldNameSpec,
  TableUpdateFieldDescriptionSpec,
  TableUpdateFieldAiConfigSpec,
  TableUpdateFieldDbFieldNameSpec,
  UpdateLongTextShowAsSpec,
  UpdateSingleLineTextShowAsSpec,
  UpdateNumberShowAsSpec,
  UpdateFormulaShowAsSpec,
  UpdateRollupShowAsSpec,
  UpdateDateFormattingSpec,
  UpdateNumberFormattingSpec,
  UpdateFormulaFormattingSpec,
  UpdateRollupFormattingSpec,
  UpdateLongTextDefaultValueSpec,
  UpdateSingleLineTextDefaultValueSpec,
  UpdateNumberDefaultValueSpec,
  UpdateDateDefaultValueSpec,
  UpdateCheckboxDefaultValueSpec,
  UpdateSingleSelectDefaultValueSpec,
  UpdateMultipleSelectDefaultValueSpec,
  UpdateUserDefaultValueSpec,
  UpdateRatingIconSpec,
  UpdateRatingColorSpec,
  UpdateButtonLabelSpec,
  UpdateButtonColorSpec,
  UpdateButtonMaxCountSpec,
  UpdateButtonResetCountSpec,
  UpdateSingleSelectAutoNewOptionsSpec,
  UpdateMultipleSelectAutoNewOptionsSpec,
  UpdateUserNotificationSpec,
];

/**
 * Whether applying this field-update spec can rewrite or invalidate stored
 * cell data. Conservative: only specs known to be metadata/display-only
 * return false.
 *
 * Two specs are predicate-dependent rather than absolute:
 * - reducing a rating max clamps stored cells (`UPDATE ... WHERE col > max`),
 *   while raising it touches nothing;
 * - setting hasError invalidates stored computed values, clearing it does not.
 */
export const fieldUpdateSpecRequiresDataRewrite = (
  spec: ISpecification<Table, ITableSpecVisitor>
): boolean => {
  if (spec instanceof UpdateRatingMaxSpec) {
    return spec.isMaxReducing();
  }
  if (spec instanceof TableUpdateFieldHasErrorSpec) {
    return spec.isSettingError();
  }
  return !nonDataAffectingSpecClasses.some((specClass) => spec instanceof specClass);
};
