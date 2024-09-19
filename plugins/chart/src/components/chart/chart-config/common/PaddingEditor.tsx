import { Input, Label } from '@teable/ui-lib';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IChartPadding } from '../../../types';

export const PaddingEditor = (props: {
  value?: IChartPadding;
  onChange: (value?: IChartPadding) => void;
}) => {
  const { value, onChange } = props;
  const { t } = useTranslation();
  const [padding, setPadding] = useState(value);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Label className="w-14 text-right text-xs">{t('form.padding.top')}</Label>
        <Input
          type="number"
          className="h-7 text-[13px]"
          value={padding?.top || ''}
          onBlur={() => onChange(padding)}
          onChange={(e) => {
            setPadding({
              ...padding,
              top: e.target.value ? parseFloat(e.target.value) : undefined,
            });
          }}
        />
      </div>
      <div className="flex items-center gap-2">
        <Label className="w-14 text-right text-xs">{t('form.padding.right')}</Label>
        <Input
          type="number"
          className="h-7 text-[13px]"
          value={padding?.right || ''}
          onBlur={() => onChange(padding)}
          onChange={(e) => {
            setPadding({
              ...padding,
              right: e.target.value ? parseFloat(e.target.value) : undefined,
            });
          }}
        />
      </div>
      <div className="flex items-center gap-2">
        <Label className="w-14 text-right text-xs">{t('form.padding.bottom')}</Label>
        <Input
          type="number"
          className="h-7 text-[13px]"
          value={padding?.bottom || ''}
          onBlur={() => onChange(padding)}
          onChange={(e) => {
            setPadding({
              ...padding,
              bottom: e.target.value ? parseFloat(e.target.value) : undefined,
            });
          }}
        />
      </div>
      <div className="flex items-center gap-2">
        <Label className="w-14 text-right text-xs">{t('form.padding.left')}</Label>
        <Input
          type="number"
          className="h-7 text-[13px]"
          value={padding?.left || ''}
          onBlur={() => onChange(padding)}
          onChange={(e) => {
            setPadding({
              ...padding,
              left: e.target.value ? parseFloat(e.target.value) : undefined,
            });
          }}
        />
      </div>
    </div>
  );
};
