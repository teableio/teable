import type { IUserIntegrationItemVo } from '@teable/openapi';
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@teable/ui-lib/shadcn';
import { Check, ChevronDown, Plus } from 'lucide-react';
import { useTranslation } from 'next-i18next';

/** Who a connection is at its app: the address the provider recorded, else the row's name. */
export const connectedAccountLabel = (item: IUserIntegrationItemVo): string =>
  item.metadata?.userInfo?.email ?? item.name;

/**
 * "Connected: <account>", with the account as a menu: the provider's other accounts on
 * file, and a way to connect one more. A provider can be connected under several
 * accounts, and which one an import reads from is the user's call — a label alone
 * would say which, not let them change it.
 */
export const ConnectedAccountMenu = ({
  accounts,
  current,
  onChange,
  onConnectAnother,
  label,
  disabled,
  className,
}: {
  accounts: IUserIntegrationItemVo[];
  current: IUserIntegrationItemVo;
  onChange: (item: IUserIntegrationItemVo) => void;
  /** Opens the provider's consent screen for one more account; absent, the menu only switches. */
  onConnectAnother?: () => void;
  /** The "Connected: {{account}}" text of the host; the account is passed in. */
  label: (account: string) => string;
  disabled?: boolean;
  className?: string;
}) => {
  const { t } = useTranslation('common');
  // The current account is listed even before the list that holds it has refetched.
  const listed = accounts.some((item) => item.id === current.id)
    ? accounts
    : [current, ...accounts];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'inline-flex max-w-full items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:pointer-events-none',
            className
          )}
        >
          <span className="truncate">{label(connectedAccountLabel(current))}</span>
          <ChevronDown className="size-3 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {listed.map((item) => (
          <DropdownMenuItem key={item.id} className="gap-2" onSelect={() => onChange(item)}>
            <Check
              className={cn(
                'size-3.5 shrink-0',
                item.id === current.id ? 'opacity-100' : 'opacity-0'
              )}
            />
            <span className="truncate">{connectedAccountLabel(item)}</span>
          </DropdownMenuItem>
        ))}
        {onConnectAnother && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2" onSelect={onConnectAnother}>
              <Plus className="size-3.5 shrink-0" />
              {t('import.connectAnotherAccount')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
