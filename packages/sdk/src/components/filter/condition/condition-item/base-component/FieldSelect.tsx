import { useComponent } from '../../../hooks';
import type { IBaseFilterCustomComponentProps } from '../../../types';

interface IFieldSelectProps extends IBaseFilterCustomComponentProps {
  value: unknown;
}

export const FieldSelect = (props: IFieldSelectProps) => {
  const { path, value, item } = props;
  const { FieldComponent } = useComponent();

  return <FieldComponent path={path} value={value} item={item} />;
};
