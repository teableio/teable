import { isConditionGroup } from '../types';
import type { IFilterPath, IBaseFilterItem, IBaseConditionProps } from '../types';
import { ConditionItem, ConditionGroup } from './condition-item';

interface IConditionProps extends IBaseConditionProps {
  path: IFilterPath;
  value: IBaseFilterItem;
  conjunction: 'or' | 'and';
}

export const Condition = (props: IConditionProps) => {
  const { index, path, value, depth } = props;

  return (
    <div className="flex w-full items-start">
      {isConditionGroup(value) ? (
        <ConditionGroup
          path={[...path]}
          index={index}
          depth={depth + 1}
          conjunction={value.conjunction}
        >
          {value.children.map((item, idx) => {
            return (
              <Condition
                key={idx}
                index={idx}
                value={item}
                path={[...path, 'children', idx]}
                depth={depth + 1}
                conjunction={value.conjunction}
              />
            );
          })}
        </ConditionGroup>
      ) : (
        <ConditionItem value={value} depth={depth + 1} index={index} path={[...path]} />
      )}
    </div>
  );
};
