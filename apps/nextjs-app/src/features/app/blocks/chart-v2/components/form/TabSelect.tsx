import { cn, Tabs, TabsList, TabsTrigger } from '@teable/ui-lib/shadcn';
import { useMemo } from 'react';

interface ITabSelectProps {
  options: {
    label: string;
    value: string;
  }[];
  value: string | null;
  defaultValue?: string;
  onChange: (value: string) => void;
  className?: string;
}

export const TabSelect = (props: ITabSelectProps) => {
  const { options, value, defaultValue: propsDefaultValue, onChange, className } = props;
  const defaultValue = useMemo(() => {
    return propsDefaultValue ?? options.at(0)?.value;
  }, [options, propsDefaultValue]);

  return (
    <Tabs
      defaultValue={defaultValue}
      value={value ?? undefined}
      onValueChange={(value) => {
        onChange(value);
      }}
    >
      <TabsList className={cn('w-full', className)}>
        {options.map((option) => (
          <TabsTrigger key={option.value} value={option.value} className="w-full">
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
};
