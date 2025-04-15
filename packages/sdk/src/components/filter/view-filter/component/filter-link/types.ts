import type { LinkField } from '../../../../../model';
import type { ILinkContext } from './context';

export interface IFilterLinkProps<T = string[] | string> {
  field: LinkField;
  operator: string;
  value: T | null;
  onSelect: (value: T | null) => void;
  className?: string;
  context?: ILinkContext;
  modal?: boolean;
}

export interface IFilterLinkSelectListProps {
  field: LinkField;
  operator: string;
  value: string | string[] | null;
  onClick: (value: string) => void;
}
