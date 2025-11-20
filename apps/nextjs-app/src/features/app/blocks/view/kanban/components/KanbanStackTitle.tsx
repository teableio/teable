import { CellValue } from '@teable/sdk/components';
import { useTranslation } from 'next-i18next';
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

  const { data: stackData, count: stackCount } = stack;

  return (
    <>
      {isUncategorized ? (
        <div className="flex items-center space-x-2 overflow-hidden text-muted-foreground">
          <span className="text-sm font-semibold">{t('table:kanban.stack.uncategorized')}</span>
          <span className="rounded-xl border px-2 text-xs">{stackCount}</span>
        </div>
      ) : (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div
          className="flex items-center space-x-2 overflow-hidden text-muted-foreground"
          onClick={onClick}
        >
          <div className="min-w-0 flex-1 overflow-hidden">
            <CellValue
              field={stackField}
              value={stackData}
              ellipsis
              className="flex-nowrap overflow-hidden"
              itemClassName="overflow-hidden shrink-0"
            />
          </div>
          <span className="shrink-0 rounded-xl border px-2 text-xs">{stackCount}</span>
        </div>
      )}
    </>
  );
};
