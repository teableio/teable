import type { IConjunction } from '@teable/core';
import { cn } from '@teable/ui-lib';
import { useTranslation } from '../../../context/app/i18n';
import { useCrud } from '../hooks';
import type { IBaseIndexProps, IFilterPath } from '../types';
import { ConjunctionSelect } from './ConjunctionSelect';

interface IConjunctionProps extends IBaseIndexProps {
  path: IFilterPath;
  value: IConjunction;
}

enum ConjunctionPosition {
  WHERE = 0,
  SELECTOR = 1,
  JOIN = 2,
}

const Conjunction = (props: IConjunctionProps) => {
  const { t } = useTranslation();
  const { onChange } = useCrud();
  const { index, value, path } = props;

  const onChangeConjunctionHandler = (val: IConjunction | null) => {
    const conjunctionPath = path.slice(0, -3).concat('conjunction');
    onChange(conjunctionPath, val);
  };

  return (
    <div className={cn('flex shrink-0 justify-start min-w-16 box-border')}>
      {index === ConjunctionPosition.WHERE ? (
        <span className="px-1 text-sm leading-9">{t('filter.conjunction.where')}</span>
      ) : null}
      {index === ConjunctionPosition.SELECTOR ? (
        <ConjunctionSelect value={value} onSelect={onChangeConjunctionHandler} />
      ) : null}
      {index >= ConjunctionPosition.JOIN ? (
        <span className="px-1 text-[13px] leading-9">
          {value === 'or' ? t('filter.conjunction.or') : t('filter.conjunction.and')}
        </span>
      ) : null}
    </div>
  );
};

export { Conjunction };
