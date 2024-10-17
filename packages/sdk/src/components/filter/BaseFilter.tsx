import { Plus } from '@teable/icons';
import { Button, cn } from '@teable/ui-lib';
import { produce } from 'immer';
import { set, get } from 'lodash';
import { useCallback, useMemo } from 'react';
import { useTranslation } from '../../context/app/i18n';
import { Condition } from './condition';
import { BaseFilterContext } from './context';
import { useControllableState } from './hooks';
import type {
  IConditionItem,
  IConditionGroup,
  IBaseFilterValue,
  IFilterBaseComponent,
  IConditionItemProperty,
  IComponentWithChildren,
  IFilterPath,
  IBaseFilterItem,
} from './types';

export interface IBaseFilterProps<T extends IConditionItemProperty = IConditionItemProperty> {
  maxDepth?: number;
  value?: IBaseFilterValue<T>;
  defaultValue?: IBaseFilterValue<T>;
  defaultItemValue?: IConditionItem<T>;
  defaultGroupValue?: IConditionGroup<T>;
  onChange: (value: IBaseFilterValue<T>) => void;
  components: {
    FieldComponent: IFilterBaseComponent<T>;
    OperatorComponent: IFilterBaseComponent<T>;
    ValueComponent: IFilterBaseComponent<T>;
  };
  footerClassName?: string;
  contentClassName?: string;
}

const DEFAULT_VALUE = {
  conjunction: 'and',
  children: [],
};

export const BaseFilter = <T extends IConditionItemProperty>(props: IBaseFilterProps<T>) => {
  const { t } = useTranslation();
  const {
    onChange,
    maxDepth = 2,
    defaultValue = DEFAULT_VALUE as IBaseFilterValue<T>,
    value: valueProp = DEFAULT_VALUE as IBaseFilterValue<T>,
    defaultItemValue,
    defaultGroupValue: defaultGroupValueFromProps,
    footerClassName,
    contentClassName,
  } = props;

  const [value, setValue] = useControllableState({
    prop: valueProp,
    defaultProp: defaultValue,
    onChange: onChange,
  });

  const { conjunction, children } = valueProp;

  const defaultGroupValue = useMemo<IBaseFilterItem<T>>(
    () =>
      defaultGroupValueFromProps || {
        conjunction: 'and',
        children: [],
      },
    [defaultGroupValueFromProps]
  );

  const createCondition = useCallback(
    (path: IFilterPath, type: 'item' | 'group') => {
      const newFilter = produce(value, (draft) => {
        const target = get(draft, path);
        target.push(type === 'item' ? { ...defaultItemValue } : { ...defaultGroupValue });
      });
      setValue(newFilter);
    },
    [defaultGroupValue, defaultItemValue, setValue, value]
  );

  const onChangeHandler = useCallback(
    (path: IFilterPath, newValue: unknown) => {
      if (value) {
        const newFilter = produce(value, (draft) => {
          set(draft, path, newValue);
        });
        setValue(newFilter);
      }
    },
    [setValue, value]
  );

  const onDeleteHandler = useCallback(
    (path: IFilterPath) => {
      const parentPath = path.slice(0, -1);
      const index = path.slice(-1);

      if (value && index !== undefined && parentPath) {
        const newFilter = produce(value, (draft) => {
          const target = parentPath.length ? get(draft, parentPath) : draft;
          target.splice(index, 1);
        });
        setValue(newFilter);
      }
    },
    [setValue, value]
  );

  const footer = (
    <div className={cn('flex justify-start gap-1', footerClassName)}>
      <Button
        variant="ghost"
        size="xs"
        onClick={() =>
          setValue({
            conjunction: valueProp.conjunction,
            children: [
              ...children,
              defaultItemValue
                ? { ...defaultItemValue }
                : ({ field: null, operator: null, value: null } as T),
            ],
          })
        }
      >
        <Plus />
        {t('filter.addCondition')}
      </Button>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => {
          setValue({
            conjunction: valueProp.conjunction,
            children: [...children, { ...defaultGroupValue }],
          });
        }}
      >
        <Plus />
        {t('filter.addConditionGroup')}
      </Button>
    </div>
  );

  return (
    <BaseFilterContext.Provider
      value={{
        maxDepth: maxDepth,
        onChange: onChangeHandler,
        onDelete: onDeleteHandler,
        createCondition: createCondition,
        getValue: () => value!,
        component: props.components,
      }}
    >
      {children.length > 0 && (
        <div className={cn('flex flex-1 flex-col overflow-auto', contentClassName)}>
          {children.map((condition, index) => (
            <Condition
              key={index}
              index={index}
              value={condition}
              path={['children', index]}
              depth={0}
              conjunction={conjunction}
            />
          ))}
        </div>
      )}

      {footer}
    </BaseFilterContext.Provider>
  );
};

export const BaseFilterFooter = (props: IComponentWithChildren) => {
  return <div>{props.children}</div>;
};
