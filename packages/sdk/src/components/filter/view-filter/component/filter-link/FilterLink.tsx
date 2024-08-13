import { INPUT_OPERATORS } from './constant';
import { FilterLinkContext } from './context';
import { FilterLinkInput } from './FilterLinkInput';
import { FilterLinkSelect } from './FilterLinkSelect';
import type { IFilterLinkProps } from './types';

/**
 * why use props emit filter link context
 * just for reuse this component in other place, making it more flexible
 */
export const FilterLink = (props: IFilterLinkProps) => {
  return (
    <FilterLinkContext.Provider value={{ context: props.context }}>
      <FilterLinkBase
        {...props}
        components={{
          Input: FilterLinkInput,
          Select: FilterLinkSelect,
        }}
      />
    </FilterLinkContext.Provider>
  );
};

interface IFilterLinkBaseProps extends IFilterLinkProps {
  components?: {
    Input?: typeof FilterLinkInput;
    Select?: typeof FilterLinkSelect;
  };
}

export const FilterLinkBase = (props: IFilterLinkBaseProps) => {
  const { components, ...rest } = props;
  const isInput = INPUT_OPERATORS.includes(props.operator);
  const InputCom = components?.Input ?? FilterLinkInput;
  const SelectCom = components?.Select ?? FilterLinkSelect;

  if (isInput) {
    return <InputCom {...rest} value={rest.value as string} />;
  }
  return <SelectCom {...rest} />;
};
