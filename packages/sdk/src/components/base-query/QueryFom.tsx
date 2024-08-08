import { Plus } from '@teable/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@teable/ui-lib';
import { useTranslation } from '../../context/app/i18n';
import { useTables } from '../../hooks';

export const QueryFrom = (props: {
  onClick?: (type: 'table' | 'source', tableId?: string) => void;
}) => {
  const tables = useTables();
  const { onClick } = props;
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="text-[13px]" variant="outline" size={'xs'}>
          {t('baseQuery.add')}
          <Plus />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t('baseQuery.from.fromTable')}</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent>
              {tables.map((table) => (
                <DropdownMenuItem key={table.id} onClick={() => onClick?.('table', table.id)}>
                  {table.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
        <DropdownMenuItem onClick={() => onClick?.('source')}>
          {t('baseQuery.from.fromQuery')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
