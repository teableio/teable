import { ArrowUpDown } from '@teable/icons';
import { useTranslation } from 'next-i18next';
import { useRef } from 'react';
import { useClickAway } from 'react-use';
import { tableConfig } from '@/features/i18n/table.config';

interface IRowStatusContainerProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  onClickOutside?: () => void;
}

export const PresortRowContainer = (props: IRowStatusContainerProps) => {
  const { style, children, onClickOutside } = props;
  const prefillingGridContainerRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  useClickAway(prefillingGridContainerRef, () => {
    onClickOutside?.();
  });

  return (
    <div
      ref={prefillingGridContainerRef}
      className="absolute left-0 w-full border-y-2 border-violet-500 dark:border-violet-700"
      style={style}
    >
      <div className="absolute left-0 top-[-32px] flex h-8 items-center rounded-ss-lg bg-violet-500 px-2 py-1 text-background dark:border-violet-700">
        <ArrowUpDown className="mr-1" />
        <span className="text-[13px]">{t('table:grid.presortRowTitle')}</span>
      </div>
      {children}
    </div>
  );
};
