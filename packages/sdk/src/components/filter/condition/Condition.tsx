import { isConditionGroup } from '../types';
import type { IFilterPath, IBaseFilterItem, IBaseConditionProps } from '../types';
import { ConditionItem, ConditionGroup } from './condition-item';
import { Conjunction } from './Conjunction';

interface IConditionProps extends IBaseConditionProps {
  path: IFilterPath;
  value: IBaseFilterItem;
  conjunction: 'or' | 'and';
}

export const Condition = (props: IConditionProps) => {
  const { index, path, value, depth, conjunction } = props;

  return (
    <div className="my-1 flex w-full items-start gap-2">
      <Conjunction index={index} path={[...path, 'conjunction']} value={conjunction} />
      {isConditionGroup(value) ? (
        <ConditionGroup path={[...path]} index={index} depth={depth + 1}>
          {value.children.map((item, index) => {
            return (
              <Condition
                key={index}
                index={index}
                value={item}
                path={[...path, 'children', index]}
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
