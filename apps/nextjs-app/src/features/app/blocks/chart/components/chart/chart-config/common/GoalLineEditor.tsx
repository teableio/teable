import { Input, Label, Switch } from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import type { IGoalLine } from '../../../../types';
import { ConfigItem } from './ConfigItem';

export const GoalLineEditor = (props: {
  value?: IGoalLine;
  onChange: (value?: IGoalLine) => void;
}) => {
  const { value, onChange } = props;
  const { t } = useTranslation('chart');
  const [text, setText] = useState(value?.label);
  const [number, setNumber] = useState(value?.value);

  return (
    <div>
      <div className="flex items-center justify-between">
        <Label className="text-sm font-normal" htmlFor="goal-line-switch">
          {t('form.combo.goalLine.label')}
        </Label>
        <Switch
          id="goal-line-switch"
          checked={value?.enabled}
          onCheckedChange={(e) => {
            onChange({
              ...value,
              enabled: e,
            });
          }}
        />
      </div>
      {value?.enabled && (
        <div className="space-y-3">
          <ConfigItem label={t('form.value')}>
            <Input
              type="number"
              className="h-7 text-[13px]"
              value={number || ''}
              onBlur={() =>
                onChange({
                  ...props.value,
                  value: number,
                })
              }
              onChange={(e) => {
                const number = parseFloat(e.target.value);
                setNumber(isNaN(number) ? undefined : number);
              }}
            />
          </ConfigItem>
          <ConfigItem label={t('form.label')}>
            <Input
              className="h-7 text-[13px]"
              value={text || ''}
              onBlur={() =>
                onChange({
                  ...value,
                  label: text,
                })
              }
              onChange={(e) => setText(e.target.value)}
            />
          </ConfigItem>
        </div>
      )}
    </div>
  );
};
