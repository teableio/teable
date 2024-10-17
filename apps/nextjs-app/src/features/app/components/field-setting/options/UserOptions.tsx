import { useQuery } from '@tanstack/react-query';
import type { CellValueType, IUserCellValue, IUserFieldOptions } from '@teable/core';
import { getBaseCollaboratorList } from '@teable/openapi';
import { UserEditor } from '@teable/sdk/components';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId } from '@teable/sdk/hooks';
import { Label, Switch } from '@teable/ui-lib';
import { keyBy } from 'lodash';
import { useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';
import { DefaultValue } from '../DefaultValue';

export const UserOptions = (props: {
  options: Partial<IUserFieldOptions> | undefined;
  isLookup?: boolean;
  cellValueType?: CellValueType;
  onChange?: (options: Partial<IUserFieldOptions>) => void;
}) => {
  const { options = {}, isLookup, onChange } = props;
  const { isMultiple, shouldNotify } = options;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const baseId = useBaseId();

  const { data: collaborators, isLoading } = useQuery({
    queryKey: ReactQueryKeys.baseCollaboratorList(baseId as string, { includeSystem: true }),
    queryFn: ({ queryKey }) =>
      getBaseCollaboratorList(queryKey[1], queryKey[2]).then((res) => res.data),
  });

  const onIsMultipleChange = (checked: boolean) => {
    onChange?.({
      isMultiple: checked,
    });
  };

  const onShouldNotifyChange = (checked: boolean) => {
    onChange?.({
      shouldNotify: checked,
    });
  };

  const onDefaultValueChange = (defaultValue: IUserCellValue | IUserCellValue[] | undefined) => {
    onChange?.({
      defaultValue: Array.isArray(defaultValue) ? defaultValue.map((v) => v.id) : defaultValue?.id,
    });
  };

  const defaultValueToUser = (
    options: IUserFieldOptions
  ): IUserCellValue | IUserCellValue[] | undefined => {
    if (!options.defaultValue || !collaborators) return undefined;
    const userMap = keyBy<{
      userName: string;
      userId: string;
      email: string;
      avatar?: string | null;
    }>(collaborators, 'userId');
    userMap['me'] = {
      userName: t('sdk:filter.currentUser'),
      userId: 'me',
      email: '',
    };
    const { defaultValue, isMultiple } = options;
    const values = [defaultValue].flat();
    if (isMultiple) {
      return values
        .filter((id) => userMap[id])
        .map((id) => ({
          title: userMap[id].userName,
          id: userMap[id].userId,
          email: userMap[id].email,
          avatarUrl: userMap[id].avatar,
        }));
    }

    const user = userMap[values[0]];
    if (!user) return undefined;
    return {
      title: user.userName,
      id: user.userId,
      email: user.email,
      avatarUrl: user.avatar,
    };
  };

  return (
    <div className="form-control space-y-2">
      {!isLookup && (
        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            <Switch
              id="field-options-is-multiple"
              checked={Boolean(isMultiple)}
              onCheckedChange={onIsMultipleChange}
            />
            <Label htmlFor="field-options-is-multiple" className="font-normal">
              {t('table:field.editor.allowMultiUsers')}
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <Switch
              id="field-options-should-notify"
              checked={Boolean(shouldNotify)}
              onCheckedChange={onShouldNotifyChange}
            />
            <Label htmlFor="field-options-should-notify" className="font-normal">
              {t('table:field.editor.notifyUsers')}
            </Label>
          </div>
          {!isLoading && (
            <DefaultValue onReset={() => onDefaultValueChange(undefined)}>
              <UserEditor
                value={defaultValueToUser(options)}
                onChange={onDefaultValueChange}
                options={options}
                includeMe
              />
            </DefaultValue>
          )}
        </div>
      )}
    </div>
  );
};
