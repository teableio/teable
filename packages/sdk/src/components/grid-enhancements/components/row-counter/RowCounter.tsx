import { ChevronLeft, ChevronRight } from '@teable/icons';
import { Button, cn } from '@teable/ui-lib';
import { useState } from 'react';
import { useTranslation } from '../../../../context/app/i18n';

interface IRowCounterProps {
  rowCount: number;
  className?: string;
}

export const RowCounter = (props: IRowCounterProps) => {
  const { rowCount, className } = props;
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<boolean>(false);

  const onClick = () => {
    setCollapsed(!collapsed);
  };

  const Icon = collapsed ? ChevronRight : ChevronLeft;

  return (
    <div
      className={cn(
        'flex items-center h-6 pl-2 ml-1 text-xs bg-violet-200 dark:bg-zinc-600 rounded',
        className
      )}
    >
      {collapsed ? rowCount : t('common.rowCount', { count: rowCount })}
      <Button
        variant={'ghost'}
        size={'xs'}
        className="ml-[2px] h-full rounded-l-none p-[2px] hover:bg-violet-300 dark:hover:bg-zinc-500"
        onClick={onClick}
      >
        <Icon className="size-3" />
      </Button>
    </div>
  );
};
