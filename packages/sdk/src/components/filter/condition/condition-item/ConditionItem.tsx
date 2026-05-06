import { AlertTriangle, Trash } from '@teable/icons';
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib';
import { useTranslation } from '../../../../context/app/i18n';
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
  const itemError = useFilterItemError(path);

  return (
    <div className="flex items-center gap-2 self-center rounded-md">
      <FieldSelect path={[...path, 'field']} value={value.field} item={value} />
      <OperatorSelect path={[...path, 'operator']} value={value.operator} item={value} />
      <FieldValue path={[...path, 'value']} value={value.value} item={value} />

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
      {itemError && (
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
  );
};
