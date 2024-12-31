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
  onSearch?: (value: string) => void;
  className?: string;
  popoverClassName?: string;
  placeholderClassName?: string;
  disabled?: boolean;
  notFoundText?: string;
  onSelect: (value: V | null) => void;
  optionRender?: (option: O) => React.ReactElement;
  displayRender?: (option: O) => React.ReactElement;
  placeholder?: string;
  cancelable?: boolean;
  modal?: boolean;
  defaultLabel?: React.ReactNode;
}

interface IBaseMultipleSelect<V, O = IOption<V>>
  extends Omit<IBaseSelect<V, O>, 'onSelect' | 'value'> {
  value: V[] | null;
  onSelect: (value: V[]) => void;
}

export type { IOption, IColorOption, IBaseSelect, IBaseMultipleSelect };
