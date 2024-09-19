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
import { useTranslation } from '../../../context/app/i18n';
import { useTables } from '../../../hooks';
import { FormItem } from '../FormItem';

export const QueryFrom = (props: {
  addButton?: boolean;
  children?: React.ReactNode;
  maxDepth?: boolean;
  onClick?: (type: 'table' | 'query', tableId?: string) => void;
}) => {
  const tables = useTables();
  const { addButton, children, onClick, maxDepth } = props;
  const { t } = useTranslation();

  return (
    <div className="mb-4 flex gap-5 text-sm">
      <FormItem label={t('baseQuery.from.title')}>
        <div className="flex-1">
          {addButton && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="text-[13px]" variant="outline" size={'xs'}>
                  {t('baseQuery.add')}
                  <Plus />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                {maxDepth ? (
                  <div className="max-h-80 overflow-y-auto">
                    {tables.map((table) => (
                      <DropdownMenuItem key={table.id} onClick={() => onClick?.('table', table.id)}>
                        {table.name}
                      </DropdownMenuItem>
                    ))}
                  </div>
                ) : (
                  <>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        {t('baseQuery.from.fromTable')}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuPortal>
                        <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                          {tables.map((table) => (
                            <DropdownMenuItem
                              key={table.id}
                              onClick={() => onClick?.('table', table.id)}
                            >
                              {table.name}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuPortal>
                    </DropdownMenuSub>
                    <DropdownMenuItem onClick={() => onClick?.('query')}>
                      {t('baseQuery.from.fromQuery')}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {children}
        </div>
      </FormItem>
    </div>
  );
};
