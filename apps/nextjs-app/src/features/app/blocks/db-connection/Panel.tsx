import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Database } from '@teable-group/icons';
import { deleteDbConnection, getDbConnection, createDbConnection } from '@teable-group/openapi';
import { useBase } from '@teable-group/sdk/hooks';
import { Button, CardDescription, Input, Label, Skeleton } from '@teable-group/ui-lib/shadcn';

export const DbConnectionPanel: React.FC = () => {
  const base = useBase();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['connection', base.id],
    queryFn: ({ queryKey }) => getDbConnection(queryKey[1]),
  });

  const mutationCreate = useMutation(createDbConnection, {
    onSuccess: () => {
      queryClient.invalidateQueries(['connection', base.id]);
    },
  });

  const mutationDelete = useMutation(deleteDbConnection, {
    onSuccess: () => {
      queryClient.invalidateQueries(['connection', base.id]);
    },
  });

  const dataArray = data?.data?.dsn
    ? Object.entries(data?.data?.dsn).map(([label, value]) => {
        if (label === 'params') {
          return {
            label,
            value: Object.entries(value)
              .map((v) => v.join('='))
              .join('&'),
          };
        }
        return { label, value: String(value ?? '') };
      })
    : [];
  dataArray.unshift({
    label: 'url',
    value: data?.data?.url || '',
  });

  return (
    <div className="flex flex-col gap-8">
      <CardDescription>
        A db connection url that directly access to all tables in the base
      </CardDescription>
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {dataArray.map(({ label, value }) => (
              <div key={label} className="flex flex-col gap-2">
                {data?.data ? (
                  <div className="flex items-center gap-2">
                    <Label className="w-20" htmlFor="subject">
                      {label}
                    </Label>
                    <Input readOnly value={value} />
                    <Button
                      className="shrink-0"
                      size="icon"
                      variant={'outline'}
                      onClick={() => {
                        navigator.clipboard.writeText(value);
                      }}
                    >
                      <Copy className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex h-20 justify-center">
                    <Database className="size-20 text-neutral-600" />
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            {data?.data ? (
              <Button onClick={() => mutationDelete.mutate(base.id)}>Delete</Button>
            ) : (
              <Button onClick={() => mutationCreate.mutate(base.id)}>Create</Button>
            )}
          </div>
        </>
      )}
    </div>
  );
};
