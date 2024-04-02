import type { Colors } from '@teable/core';

interface IOption<T = string> {
  value: T;
  label: string;
}

interface IColorOption extends IOption {
  color: Colors;
}

interface IBaseSelect<V, O = IOption<V>> {
  options: O[];
  value: string | null;
  search?: boolean | (() => void);
  className?: string;
  popoverClassName?: string;
  disabled?: boolean;
  notFoundText?: string;
  onSelect: (value: V | null) => void;
  optionRender?: (option: O) => React.ReactElement;
  displayRender?: (option: O) => React.ReactElement;
  placeholder?: string;
}

interface IBaseMultipleSelect<V, O = IOption<V>>
  extends Omit<IBaseSelect<V, O>, 'onSelect' | 'value'> {
  value: V[] | null;
  onSelect: (value: V[]) => void;
}

export type { IOption, IColorOption, IBaseSelect, IBaseMultipleSelect };
