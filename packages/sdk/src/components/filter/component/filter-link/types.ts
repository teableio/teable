import type { LinkField } from '../../../../model';

export interface IFilterLinkProps<T = string[] | string> {
  field: LinkField;
  operator: string;
  value: T | null;
  onSelect: (value: T | null) => void;
}

export interface IFilterLinkSelectListProps {
  field: LinkField;
  operator: string;
  value: string | string[] | null;
  onClick: (value: string) => void;
}
