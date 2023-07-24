import { useRecords, AnchorProvider } from '@teable-group/sdk';
import type { LinkField } from '@teable-group/sdk';

import { useCallback, useMemo } from 'react';
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
    label: name,
    value: id,
  }));
  const shouldInput = useMemo(() => {
    return !INPUTOPERTORS.includes(operator);
  }, [operator]);

  const displayRender = useCallback((option: typeof options[number]) => {
    return (
      <div
        className="px-2 rounded-lg bg-secondary text-secondary-foreground mx-1 truncate"
        key={option.value}
      >
        {option?.label || 'Untitled'}
      </div>
    );
  }, []);

  const optionRender = useCallback((option: typeof options[number]) => {
    return (
      <div
        key={option.value}
        className="px-2 rounded-lg bg-secondary text-secondary-foreground truncate"
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
            className="w-44"
            popoverClassName="w-44"
          />
        ) : (
          <BaseMultipleSelect
            options={options}
            onSelect={onSelect}
            value={values as string[]}
            displayRender={displayRender}
            optionRender={optionRender}
            className="w-44"
            popoverClassName="w-44"
          />
        )
      ) : (
        <FilterInput placeholder="Enter a value" value={values} onChange={onSelect} />
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
