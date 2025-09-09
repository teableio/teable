import { useTranslation } from 'next-i18next';
import type { IBarConfig } from '../../../../types';
import { SwitchEditor } from '../common/SwitchEditor';
import { ComboForm } from './ComboForm';

export const BarForm = (props: { config: IBarConfig; onChange: (config: IBarConfig) => void }) => {
  const { config, onChange } = props;
  const { t } = useTranslation('chart');
  return (
    <div className="space-y-5">
      <ComboForm
        type="bar"
        config={config}
        onChange={(val) => {
          onChange({
            type: 'bar',
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
