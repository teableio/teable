import type { InputProps } from '@teable/ui-lib/shadcn';
import { Input } from '@teable/ui-lib/shadcn';
import { debounce } from 'lodash';
import { useEffect, useMemo, useState } from 'react';

export const DebounceInput = ({
  value,
  onChange,
  ...restProps
}: {
  value: string;
  onChange: (value: string) => void;
} & Omit<InputProps, 'value' | 'onChange'>) => {
  const [search, setSearch] = useState<string>('');
  const [isComposing, setIsComposing] = useState(false);

  const setApplySearchDebounced = useMemo(() => {
    return debounce(onChange, 200);
  }, [onChange]);

  useEffect(() => {
    if (!isComposing) {
      setApplySearchDebounced(search);
    }
  }, [search, isComposing, onChange, setApplySearchDebounced]);

  return (
    <Input
      className="h-8"
      type="search"
      {...restProps}
      value={search}
      onChange={(e) => {
        const value = e.target.value;
        setSearch(value);
      }}
      onCompositionStart={() => setIsComposing(true)}
      onCompositionEnd={() => setIsComposing(false)}
    />
  );
};
