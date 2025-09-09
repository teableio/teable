import { useTranslation } from 'next-i18next';
import type { IAreaConfig } from '../../../../types';
import { SwitchEditor } from '../common/SwitchEditor';
import { ComboForm } from './ComboForm';

export const AreaForm = (props: {
  config: IAreaConfig;
  onChange: (config: IAreaConfig) => void;
}) => {
  const { config, onChange } = props;
  const { t } = useTranslation('chart');

  return (
    <div className="space-y-5">
      <ComboForm
        type="area"
        config={config}
        onChange={(val) => {
          onChange({
            type: 'area',
            ...val,
          });
        }}
      />
      <SwitchEditor
        label={t('form.combo.stack')}
        value={config.stack}
        onChange={(checked) => {
          onChange({
            ...config,
            stack: checked,
          });
        }}
      />
    </div>
  );
};
