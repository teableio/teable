import { useComponent } from '../../../hooks';
import type { IBaseFilterCustomComponentProps } from '../../../types';

export const OperatorSelect = (props: IBaseFilterCustomComponentProps) => {
  const { path, value, item } = props;
  const { OperatorComponent } = useComponent();

  return <OperatorComponent path={path} value={value} item={item} />;
};
