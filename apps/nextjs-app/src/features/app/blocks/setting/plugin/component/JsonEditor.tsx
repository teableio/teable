/* eslint-disable @typescript-eslint/no-explicit-any */
import { Textarea } from '@teable/ui-lib/shadcn';
import { useEffect, useState } from 'react';

export const JsonEditor = (props: {
  value?: Record<string, any>;
  onChange: (value: Record<string, any>) => void;
}) => {
  const { value, onChange } = props;
  const [text, setText] = useState('');
  useEffect(() => {
    setText(JSON.stringify(value, null, 2));
  }, [value]);

  const onBlur = () => {
    try {
      onChange(JSON.parse(text));
    } catch (e: any) {
      console.log(e.message);
    }
  };

  return (
    <Textarea
      value={text}
      onBlur={onBlur}
      onChange={(e) => {
        setText(e.target.value);
      }}
    />
  );
};
