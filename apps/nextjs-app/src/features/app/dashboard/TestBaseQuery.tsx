import type { IBaseQuery } from '@teable/openapi';
import { BaseQueryBuilder } from '@teable/sdk/components';
import { Button, Dialog, DialogContent, DialogTrigger } from '@teable/ui-lib/shadcn';
import { useState } from 'react';

export const TestBaseQuery = () => {
  const [query, setQuery] = useState<IBaseQuery>();
  return (
    <Dialog>
      <DialogTrigger>
        <Button size={'xs'} variant={'ghost'}>
          Open Dialog
        </Button>
      </DialogTrigger>
      <DialogContent>
        <Button className="w-7" size={'xs'} variant={'ghost'} onClick={() => setQuery(undefined)}>
          Clear Query
        </Button>
        <BaseQueryBuilder query={query} onChange={setQuery} />
      </DialogContent>
    </Dialog>
  );
};
