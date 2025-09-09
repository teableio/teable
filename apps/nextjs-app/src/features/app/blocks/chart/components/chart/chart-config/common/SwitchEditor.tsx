import { Switch, Label } from '@teable/ui-lib';
import { useRef } from 'react';

export const SwitchEditor = (props: {
  label?: string;
  value?: boolean;
  onChange: (value?: boolean) => void;
}) => {
  const { label, value, onChange } = props;
  const randomRef = useRef(Math.random().toString(36).substring(7));
  return (
    <div className="flex items-center justify-between">
      <Label className="text-sm font-normal" htmlFor={`${randomRef.current}`}>
        {label}
      </Label>
      <Switch
        id={`${randomRef.current}`}
        checked={value}
        onCheckedChange={(checked) => {
          onChange(checked);
        }}
      />
    </div>
  );
};
