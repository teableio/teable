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
    // `min-w-0` lets this shrink below the min-content width of the condition
    // tree inside it, instead of pushing the panel wider than the drawer.
    <div className="flex w-full min-w-0 items-start">
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
