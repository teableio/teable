import type { ISelectorProps as IUISelectorProps } from '@teable/ui-lib/base';
import { Selector as UISelector } from '@teable/ui-lib/base';
import { useTranslation } from 'next-i18next';

export type ISelectorProps = IUISelectorProps;

export const Selector: React.FC<ISelectorProps> = (props) => {
  const { t } = useTranslation('common');
  const {
    onChange,
    readonly,
    selectedId = '',
    placeholder,
    searchTip = t('actions.search'),
    emptyTip = t('noResult'),
    defaultName = t('untitled'),
    className,
    contentClassName,
    candidates = [],
  } = props;

  return (
    <UISelector
      onChange={onChange}
      readonly={readonly}
      selectedId={selectedId}
      placeholder={placeholder}
      searchTip={searchTip}
      emptyTip={emptyTip}
      defaultName={defaultName}
      className={className}
      contentClassName={contentClassName}
      candidates={candidates}
    />
  );
};
