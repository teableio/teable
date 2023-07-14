import classNames from 'classnames';

export interface ISelectTag {
  label: string;
  color?: string;
  backgroundColor?: string;
  className?: string;
}

export const SelectTag = ({ label, color, backgroundColor, className }: ISelectTag) => {
  return (
    <div
      className={classNames('px-2 rounded-lg bg-secondary text-secondary-foreground', className)}
      style={{ color, backgroundColor }}
    >
      {label}
    </div>
  );
};
