import { ArrowLeft } from '@teable/icons';
import { Button } from '@teable/ui-lib/shadcn';
import { type FC } from 'react';

export const AccessPage: FC = () => {
  return (
    <>
      <Button>
        <ArrowLeft />
        Go to AccessPage
      </Button>
    </>
  );
};
