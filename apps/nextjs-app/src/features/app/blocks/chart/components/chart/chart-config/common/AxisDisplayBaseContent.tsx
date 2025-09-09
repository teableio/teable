import { useTranslation } from 'next-i18next';
import type { IChartBaseAxisDisplay } from '../../../../types';
import { ComboLineStyleEditor } from './ComboLineStyleEditor';
import { ComboTypeEditor } from './ComboTypeEditor';
import { ConfigItem } from './ConfigItem';
import { YAxisPositionEditor } from './YAxisPositionEditor';

export const AxisDisplayBaseContent = (props: {
  value: IChartBaseAxisDisplay;
  onChange: (value: IChartBaseAxisDisplay) => void;
}) => {
  const { value: displayValue, onChange } = props;
  const { t } = useTranslation('chart');
  return (
    <>
      <ConfigItem label={t('form.combo.displayType')}>
        <ComboTypeEditor
          value={displayValue.type}
          onChange={(type) => {
            switch (type) {
              case 'bar': {
                return onChange({
                  type,
                  position: displayValue.position,
                });
              }

              case 'area':
              case 'line': {
                return onChange({
                  lineStyle: 'normal',
                  ...displayValue,
                  position: displayValue.position,
                  type,
                });
              }
              default:
                throw new Error('Invalid display type');
            }
          }}
        />
      </ConfigItem>
      {displayValue.type !== 'bar' && (
        <ConfigItem label={t('form.combo.lineStyle.label')}>
          <ComboLineStyleEditor
            value={displayValue.lineStyle}
            onChange={(val) => {
              onChange({
                ...displayValue,
                lineStyle: val,
              });
            }}
          />
        </ConfigItem>
      )}
      <ConfigItem label={t('form.combo.yAxis.position')}>
        <YAxisPositionEditor
          value={displayValue.position}
          onChange={(val) => {
            if (!displayValue) {
              return;
            }
            onChange({
              ...displayValue,
              position: val,
            });
          }}
        />
      </ConfigItem>
    </>
  );
};
