import { Label } from '@teable/ui-lib';

export const FormItem = (props: { label: string; children: React.ReactNode }) => {
  const { label, children } = props;
  return (
    <div className="flex flex-1 gap-5">
      <Label className="w-24 text-right leading-7">{label}</Label>
      {children}
    </div>
  );
};
