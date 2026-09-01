import { useTranslation } from '../../../../context/app/i18n';
import { BaseSingleSelect } from './base';

interface IFileTypeSelectProps {
  value: string | null;
  onSelect: (value: string | null) => void;
}

const typeOptions = [
  { value: 'image', label: 'image' },
  { value: 'text', label: 'text' },
];

function FileTypeSelect(props: IFileTypeSelectProps) {
  const { t } = useTranslation();
  const { value, onSelect } = props;
  return (
    <BaseSingleSelect
      value={value}
      onSelect={onSelect}
      options={typeOptions}
      drawerTitle={t('filter.selectValue')}
      className="w-40"
    />
  );
}

export { FileTypeSelect };
