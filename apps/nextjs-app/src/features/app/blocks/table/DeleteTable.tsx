import { useSpace } from '@teable-group/sdk/hooks';
import AshBinIcon from '@teable-group/ui-lib/icons/app/ashbin.svg';
import { useRouter } from 'next/router';
import { Button } from '@/components/ui/button';
export const DeleteTable: React.FC<{ tableId: string; className: string }> = ({
  tableId,
  className,
}) => {
  const space = useSpace();
  const router = useRouter();
  return (
    <Button
      variant={'ghost'}
      size={'xxs'}
      className={className}
      onClick={async () => {
        await space.deleteTable(tableId);
        router.push({
          pathname: '/space',
        });
      }}
    >
      <AshBinIcon />
    </Button>
  );
};
