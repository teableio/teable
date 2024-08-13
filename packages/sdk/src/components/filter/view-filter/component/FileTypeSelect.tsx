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
  const { value, onSelect } = props;
  return <BaseSingleSelect value={value} onSelect={onSelect} options={typeOptions} />;
}

export { FileTypeSelect };
