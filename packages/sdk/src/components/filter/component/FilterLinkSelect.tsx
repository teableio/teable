import { useCallback, useMemo } from 'react';
import { AnchorProvider } from '../../../context';
import { useRecords } from '../../../hooks';
import type { LinkField } from '../../../model';

import { BaseMultipleSelect, BaseSingleSelect } from './base';
import { FilterInput } from './FilterInput';

interface IFilterLinkProps {
  field: LinkField;
  operator: string;
  value: string[] | null;
  onSelect: (value: string[] | string | null) => void;
}

const INPUTOPERTORS = ['contains', 'doesNotContain'];
const SINGLESELECTOPERATORS = ['is', 'isNot'];

const FilterLinkSelectBase = (props: IFilterLinkProps) => {
  const { value, onSelect, operator } = props;
  const values = useMemo<string | string[] | null>(() => {
    return value;
  }, [value]);
  const records = useRecords();
  const options = records.map(({ id, name }) => ({
    label: name || 'Untitled',
    value: id,
  }));
  const shouldInput = useMemo(() => {
    return !INPUTOPERTORS.includes(operator);
  }, [operator]);

  const displayRender = useCallback((option: (typeof options)[number]) => {
    return (
      <div
        className="mx-1 rounded-lg bg-secondary px-2 text-secondary-foreground"
        key={option.value}
      >
        {option.label}
      </div>
    );
  }, []);

  const optionRender = useCallback((option: (typeof options)[number]) => {
    return (
      <div
        key={option.value}
        className="truncate rounded-lg bg-secondary px-2 text-secondary-foreground"
      >
        {option?.label || 'Untitled'}
      </div>
    );
  }, []);

  return (
    <>
      {shouldInput ? (
        SINGLESELECTOPERATORS.includes(operator) ? (
          <BaseSingleSelect
            options={options}
            onSelect={onSelect}
            value={values as string}
            displayRender={displayRender}
            optionRender={optionRender}
            className="w-64"
            popoverClassName="w-64"
          />
        ) : (
          <BaseMultipleSelect
            options={options}
            onSelect={onSelect}
            value={values as string[]}
            displayRender={displayRender}
            optionRender={optionRender}
            className="w-64"
            popoverClassName="w-64"
          />
        )
      ) : (
        <FilterInput placeholder="Enter a value" value={values as string} onChange={onSelect} />
      )}
    </>
  );
};

const FilterLinkSelect = (props: IFilterLinkProps) => {
  const tableId = props?.field?.options?.foreignTableId;
  return (
    <AnchorProvider tableId={tableId} fallback={<h1>Empty</h1>}>
      <FilterLinkSelectBase {...props} />
    </AnchorProvider>
  );
};

export { FilterLinkSelect };
