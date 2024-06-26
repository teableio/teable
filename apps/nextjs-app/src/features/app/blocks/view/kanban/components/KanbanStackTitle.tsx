import type { ISelectFieldChoice, IUserCellValue } from '@teable/core';
import { FieldType } from '@teable/core';
import { CellValue } from '@teable/sdk/components';
import { useTranslation } from 'react-i18next';
import { tableConfig } from '@/features/i18n/table.config';
import type { IKanbanContext } from '../context';
import { useKanban } from '../hooks';
import type { IStackData } from '../type';

interface IKanbanStackTitle {
  stack: IStackData;
  isUncategorized?: boolean;
  onClick?: () => void;
}

export const KanbanStackTitle = (props: IKanbanStackTitle) => {
  const { stack, isUncategorized, onClick } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { stackField } = useKanban() as Required<IKanbanContext>;

  const fieldType = stackField.type;
  const { data: stackData, count: stackCount } = stack;
  const isSingleSelectField = fieldType === FieldType.SingleSelect;
  const cellValue = isSingleSelectField
    ? (stackData as ISelectFieldChoice).name
    : (stackData as IUserCellValue);

  return (
    <>
      {isUncategorized ? (
        <div className="flex items-center space-x-2 overflow-hidden text-slate-500 dark:text-slate-400">
          <span className="text-sm font-semibold">{t('table:kanban.stack.uncategorized')}</span>
          <span className="rounded-xl border px-2 text-xs">{stackCount}</span>
        </div>
      ) : (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div
          className="flex items-center space-x-2 overflow-hidden text-slate-500 dark:text-slate-400"
          onClick={onClick}
        >
          <CellValue
            field={stackField}
            value={cellValue}
            className="overflow-hidden"
            itemClassName="shrink overflow-hidden"
          />
          <span className="rounded-xl border px-2 text-xs">{stackCount}</span>
        </div>
      )}
    </>
  );
};
