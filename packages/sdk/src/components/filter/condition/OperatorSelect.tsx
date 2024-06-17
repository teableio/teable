import { useContext } from 'react';
import { FilterContext } from '../context';
import { BaseOperatorSelect } from './BaseOperatorSelect';

interface IOperatorSelectProps {
  value: string | null;
  fieldId: string;
  onSelect: (value: string | null) => void;
}

function OperatorSelect(props: IOperatorSelectProps) {
  const { onSelect, fieldId, value } = props;
  const { fields } = useContext(FilterContext);
  const field = fields.find((f) => f.id === fieldId);

  return <BaseOperatorSelect field={field} onSelect={onSelect} value={value} />;
}

export { OperatorSelect };
