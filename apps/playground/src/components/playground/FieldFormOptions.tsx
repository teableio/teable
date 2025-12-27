import { match } from 'ts-pattern';
import { SingleLineTextOptions } from './field-options/SingleLineTextOptions';
import { NumberOptions } from './field-options/NumberOptions';
import { RatingOptions } from './field-options/RatingOptions';
import { SelectOptions } from './field-options/SelectOptions';
import { CheckboxOptions } from './field-options/CheckboxOptions';
import { DateOptions } from './field-options/DateOptions';
import { UserOptions } from './field-options/UserOptions';
import { ButtonOptions } from './field-options/ButtonOptions';
import { FormulaOptions } from './field-options/FormulaOptions';
import { LinkOptions } from './field-options/LinkOptions';
import { RollupOptions } from './field-options/RollupOptions';
import type { FieldFormApi } from './FieldForm';
import type { ITableFieldInput } from '@teable/v2-core';
import type { ITableDto } from '@teable/v2-contract-http';

interface FieldFormOptionsProps {
  type: ITableFieldInput['type'];
  form: FieldFormApi;
  tableId: string;
  tables: ReadonlyArray<ITableDto>;
  isTablesLoading: boolean;
}

export function FieldFormOptions({
  type,
  form,
  tableId,
  tables,
  isTablesLoading,
}: FieldFormOptionsProps) {
  return (
    <div className="space-y-4 border-t pt-4">
      <h3 className="text-sm font-medium">Field Options</h3>
      {match(type)
        .with('singleLineText', () => <SingleLineTextOptions form={form} />)
        .with('longText', () => (
          <p className="text-xs text-muted-foreground">No options for long text.</p>
        ))
        .with('number', () => <NumberOptions form={form} />)
        .with('rating', () => <RatingOptions form={form} />)
        .with('singleSelect', () => <SelectOptions form={form} />)
        .with('multipleSelect', () => <SelectOptions form={form} />)
        .with('checkbox', () => <CheckboxOptions form={form} />)
        .with('attachment', () => (
          <p className="text-xs text-muted-foreground">No options for attachment.</p>
        ))
        .with('date', () => <DateOptions form={form} />)
        .with('user', () => <UserOptions form={form} />)
        .with('button', () => <ButtonOptions form={form} />)
        .with('formula', () => <FormulaOptions form={form} />)
        .with('link', () => (
          <LinkOptions
            form={form}
            tableId={tableId}
            tables={tables}
            isTablesLoading={isTablesLoading}
          />
        ))
        .with('rollup', () => (
          <RollupOptions
            form={form}
            tableId={tableId}
            tables={tables}
            isTablesLoading={isTablesLoading}
          />
        ))
        .exhaustive()}
    </div>
  );
}
