import { Label } from '@teable/ui-lib';

export const FormItem = (props: { label: string; children: React.ReactNode }) => {
  const { label, children } = props;
  return (
    <div className="flex flex-1 flex-col gap-2 ps-4 sm:flex-row sm:gap-5 sm:ps-0">
      <Label className="shrink-0 leading-7 sm:w-24 sm:text-end">{label}</Label>
      {children}
    </div>
  );
};
