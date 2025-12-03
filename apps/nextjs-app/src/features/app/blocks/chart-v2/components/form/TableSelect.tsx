import { BaseSingleSelect } from '@teable/sdk/components/filter/view-filter/component';
import { useTables } from '@teable/sdk/hooks';
import { Table2 } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';

interface ITableSelectProps {
  value: string | null;
  onChange: (value: string) => void;
}

export const TableSelect = (props: ITableSelectProps) => {
  const table = useTables();
  const { value: originValue, onChange } = props;

  const tableList = useMemo(() => {
    return table.map(({ id, name, icon }) => ({
      value: id,
      label: name,
      icon: icon,
    }));
  }, [table]);

  const { t } = useTranslation(['chart', 'common']);

  const optionsRender = (option: (typeof tableList)[number]) => {
    return (
      <div className="flex items-center">
        <div className="shrink-0">{option.icon || <Table2 size={14} />}</div>
        <div className="truncate pl-1 text-[13px]">{option.label}</div>
      </div>
    );
  };

  const displayRender = (option: (typeof tableList)[number]) => {
    const { icon, label } = option;
    return (
      <div className="flex items-center justify-start">
        <div className="shrink-0">{icon || <Table2 size={14} />}</div>
        <div className="truncate pl-1 text-[13px]">{label}</div>
      </div>
    );
  };

  const selectHandler = (value: string | null) => {
    if (value) {
      onChange?.(value);
    }
  };

  const notFoundRender = useMemo(() => {
    return <span className="text-red-500">{t('common:noResult')}</span>;
  }, [t]);

  return (
    <BaseSingleSelect
      options={tableList}
      value={originValue}
      optionRender={optionsRender}
      displayRender={displayRender}
      onSelect={selectHandler}
      popoverClassName="w-[310px]"
      className="my-1 h-9 w-full"
      defaultLabel={notFoundRender}
      modal
    />
  );
};
