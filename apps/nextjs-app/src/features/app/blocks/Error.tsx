import type { FC } from 'react';
import { TeableLogo } from '@/components/TeableLogo';
import { useBrand } from '@/features/app/hooks/useBrand';

export const Error: FC<{ message: string }> = (props) => {
  const { message } = props;
  const { brandName } = useBrand();

  return (
    <div className="mer flex h-screen flex-col items-center justify-center">
      <div>
        <div className="flex w-full">
          <TeableLogo className="text-4xl" />
          <p className="ml-1 truncate text-4xl font-semibold">{brandName}</p>
        </div>
        <h1 className="scroll-m-20 text-3xl tracking-tight">{message}</h1>
      </div>
    </div>
  );
};
