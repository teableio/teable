import { AlertTriangle, Trash } from '@teable/icons';
import {
  Button,
  cn,
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib';
import { useTranslation } from '../../../../context/app/i18n';
import { useInDrawer } from '../../../adaptive-panel';
import { useCrud } from '../../hooks';
import type {
  IConditionItemProperty,
  IBaseConditionProps,
  IBaseFilterComponentProps,
} from '../../types';
import { useFilterItemError } from '../../view-filter/hooks';
import { FieldSelect } from './base-component/FieldSelect';
import { FieldValue } from './base-component/FieldValue';
import { OperatorSelect } from './base-component/OperatorSelect';

interface IConditionItemProps<T extends IConditionItemProperty = IConditionItemProperty>
  extends IBaseConditionProps,
    IBaseFilterComponentProps {
  value: T;
}

export const ConditionItem = <T extends IConditionItemProperty>(props: IConditionItemProps<T>) => {
  const { path, value, index } = props;
  const { onDelete } = useCrud();
  const { t } = useTranslation();
  const inDrawer = useInDrawer();
  const itemError = useFilterItemError(path);

  return (
    <div
      className={cn(
        'flex items-center gap-2 self-center rounded-md',
        inDrawer && 'w-full min-w-0 flex-wrap'
      )}
      data-filter-condition-item
    >
      {/* The controls wrap in a drawer: field and operator share the first
          line and the value editor takes a line of its own when 180px will
          not fit beside them. */}
      <div
        className={cn(
          'flex items-center gap-2',
          inDrawer && 'min-w-0 flex-1 flex-wrap items-stretch'
        )}
        data-filter-condition-controls
      >
        <FieldSelect path={[...path, 'field']} value={value.field} item={value} />
        <OperatorSelect path={[...path, 'operator']} value={value.operator} item={value} />
        <FieldValue path={[...path, 'value']} value={value.value} item={value} />
      </div>

      <div className="flex shrink-0 items-center gap-2" data-filter-condition-actions>
        <Button
          variant="ghost"
          size={'icon'}
          className="size-8 text-muted-foreground"
          onClick={() => {
            onDelete(path, index);
          }}
        >
          <Trash className="size-4" />
        </Button>
        {itemError && !inDrawer && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex size-4 shrink-0 cursor-help items-center">
                  <AlertTriangle className="size-4 text-yellow-500" />
                </span>
              </TooltipTrigger>
              <TooltipPortal>
                <TooltipContent side="top" className="max-w-xs">
                  {t('filter.invalidConditionTip')}
                </TooltipContent>
              </TooltipPortal>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* There is no hover on a phone, so the reason is spelled out in the
          row rather than hidden behind a tooltip. */}
      {itemError && inDrawer && (
        <div className="flex w-full items-start gap-1.5 text-xs text-yellow-600 dark:text-yellow-500">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          <span>{t('filter.invalidConditionTip')}</span>
        </div>
      )}
    </div>
  );
};
