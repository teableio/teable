import { INPUT_OPERATORS } from './constant';
import { FilterLinkInput } from './FilterLinkInput';
import { FilterLinkSelect } from './FilterLinkSelect';
import type { IFilterLinkProps } from './types';

export const FilterLink = (props: IFilterLinkProps) => {
  return (
    <FilterLinkBase
      {...props}
      components={{
        Input: FilterLinkInput,
        Select: FilterLinkSelect,
      }}
    />
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
