import { cn, Progress } from '@teable/ui-lib';

interface IFileItemProps {
  process: number;
}

export const Process = (props: IFileItemProps) => {
  const { process } = props;

  return (
    <div className="relative size-full">
      <div
        className={cn('absolute inset-0 z-10 flex justify-center flex-col items-center', {
          hidden: process === 100,
        })}
      >
        <Progress value={process} />
        <span className="text-center text-xs">{process}%</span>
      </div>
    </div>
  );
};
