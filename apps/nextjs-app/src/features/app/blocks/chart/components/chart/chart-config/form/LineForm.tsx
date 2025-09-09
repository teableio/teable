import type { ILineConfig } from '../../../../types';
import { ComboForm } from './ComboForm';

export const LineForm = (props: {
  config: ILineConfig;
  onChange: (config: ILineConfig) => void;
}) => {
  const { config, onChange } = props;

  return (
    <ComboForm
      type="line"
      config={config}
      onChange={(val) => {
        onChange({
          type: 'line',
          ...val,
        });
      }}
    />
  );
};
