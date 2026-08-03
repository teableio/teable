import { useComponent } from '../../../hooks';
import type { IBaseFilterCustomComponentProps } from '../../../types';

export const FieldValue = (props: IBaseFilterCustomComponentProps) => {
  const { path, value, item } = props;
  const { ValueComponent } = useComponent();

  return <ValueComponent path={path} value={value} item={item} />;
};
