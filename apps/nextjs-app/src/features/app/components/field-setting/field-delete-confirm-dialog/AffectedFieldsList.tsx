import { useFieldStaticGetter } from '@teable/sdk/hooks';
import { Separator } from '@teable/ui-lib/shadcn';
import { Table2 } from 'lucide-react';
import { Fragment } from 'react';
import type { AffectedField } from './types';

interface AffectedFieldsListProps {
  fields: AffectedField[];
}

export const AffectedFieldsList = ({ fields }: AffectedFieldsListProps) => {
  const len = fields.length;
  const fieldStaticGetter = useFieldStaticGetter();
  return (
    <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-md">
      {fields.map((field, index) => {
        const FieldIcon = fieldStaticGetter(field.type).Icon;
        return (
          <Fragment key={field.id}>
            <li className="flex items-center justify-between gap-6 px-2 py-1 text-sm">
              <p className="flex items-center gap-2 truncate font-medium">
                {FieldIcon && <FieldIcon className="size-4 shrink-0" />}
                <span className="truncate">{field.name}</span>
              </p>
              {field.tableName && (
                <p className="flex max-w-40 shrink-0 items-center gap-1 truncate text-sm text-muted-foreground">
                  <Table2 className="size-4 shrink-0" />
                  <span className="truncate">{field.tableName}</span>
                </p>
              )}
            </li>
            {index < len - 1 && <Separator className="my-1" />}
          </Fragment>
        );
      })}
    </ul>
  );
};
