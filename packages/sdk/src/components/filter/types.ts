// low types
export type IFilterPath = (string | number)[];

export interface IBaseFilterComponentProps<V = unknown> {
  path: IFilterPath;
  value: V;
  modal?: boolean;
}
export interface IBaseFilterCustomComponentProps<
  T extends IConditionItemProperty = IConditionItemProperty,
  V = unknown,
> extends IBaseFilterComponentProps<V> {
  item: T;
}

export type IFilterBaseComponent<
  T extends IConditionItemProperty = IConditionItemProperty,
  ExtraProps = Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
> = React.FC<IBaseFilterCustomComponentProps<T, any> & ExtraProps>;

export interface IBaseIndexProps {
  index: number;
}

export interface IBaseFilterProperty {
  conjunction: 'or' | 'and';
}

export interface IBaseConditionProps extends IBaseIndexProps {
  depth: number;
}

export interface IConditionItemProperty {
  field: unknown;
  operator: unknown;
  value: unknown;
}

// base common types
export type IConditionItem<T extends IConditionItemProperty = IConditionItemProperty> = T;

export interface IConditionGroup<T extends IConditionItemProperty = IConditionItemProperty>
  extends IBaseFilterProperty {
  children: (IConditionItem<T> | IConditionGroup<T>)[];
}

export type IBaseFilterItem<T extends IConditionItemProperty = IConditionItemProperty> =
  | IConditionItem<T>
  | IConditionGroup<T>;

export interface IComponentWithChildren {
  children: React.ReactNode;
}

export interface IBaseFilterValue<T extends IConditionItemProperty = IConditionItemProperty> {
  conjunction: 'or' | 'and';
  children: IBaseFilterItem<T>[];
}

// type Guard
export const isConditionGroup = <T extends IConditionItemProperty = IConditionItemProperty>(
  item: IBaseFilterItem<T>
): item is IConditionGroup<T> => {
  return 'children' in item;
};
