import { LaptopIcon } from '@radix-ui/react-icons';
import { Moon, Settings, Sun } from '@teable/icons';
import { BaseNodeResourceType } from '@teable/openapi';
import { useIsAnonymous, useIsReadOnlyPreview } from '@teable/sdk/hooks';
import { useTheme } from '@teable/ui-lib';
import { CommandGroup, CommandItem, CommandSeparator } from '@teable/ui-lib/shadcn';
import { groupBy } from 'lodash';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { Emoji } from '@/features/app/components/emoji/Emoji';
import { useSettingStore } from '@/features/app/components/setting/useSettingStore';
import { tableConfig } from '@/features/i18n/table.config';
import { BaseNodeResourceIconMap, getNodeIcon, getNodeName, getNodeUrl } from '../base-node/hooks';
import type { useBaseNodeContext } from '../base-node/hooks/useBaseNodeContext';

/** A palette that filters its own items (one that also shows server results) passes the text; one that lets cmdk filter passes nothing. */
const matches = (label: string, search?: string) =>
  !search || label.toLowerCase().includes(search.toLowerCase());

const ITEM_CLASS = 'flex h-8 gap-2';
const ICON_CLASS = 'flex size-4 shrink-0 items-center justify-center text-muted-foreground';

/**
 * One group per kind of node in the project, every node a jump to its page. Beside results from
 * other projects, each row names its project under the name, like those rows do.
 */
export const ProjectNodeGroups = ({
  baseId,
  projectName,
  treeItems,
  search,
  onNavigate,
}: {
  baseId: string;
  projectName?: string;
  treeItems: ReturnType<typeof useBaseNodeContext>['treeItems'];
  search?: string;
  onNavigate: () => void;
}) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const router = useRouter();
  const heading = (resourceType: string) => {
    switch (resourceType) {
      case BaseNodeResourceType.Table:
        return t('common:noun.table');
      case BaseNodeResourceType.Dashboard:
        return t('common:noun.dashboard');
      case BaseNodeResourceType.App:
        return t('common:noun.app');
      case BaseNodeResourceType.Workflow:
        return t('common:noun.automation');
      case BaseNodeResourceType.Routine:
        return t('common:noun.routine');
      default:
        return '';
    }
  };
  const groups = groupBy(
    Object.values(treeItems).filter(
      (item) =>
        item.resourceType !== BaseNodeResourceType.Folder && matches(getNodeName(item), search)
    ),
    'resourceType'
  );
  return (
    <>
      {Object.entries(groups).map(([resourceType, items]) => (
        <CommandGroup heading={heading(resourceType)} key={resourceType}>
          {items.map((item) => {
            const { id, resourceType, resourceId } = item;
            const name = getNodeName(item);
            const icon = getNodeIcon(item);
            const IconComponent = BaseNodeResourceIconMap[resourceType];
            const url = getNodeUrl({ baseId, resourceType, resourceId });
            return (
              <CommandItem
                className={projectName ? 'flex flex-col items-start gap-1' : ITEM_CLASS}
                key={id}
                value={id}
                keywords={[name]}
                onSelect={() => {
                  onNavigate();
                  if (url) router.push(url);
                }}
              >
                <div className="flex w-full items-center gap-2">
                  <div className={ICON_CLASS}>
                    {icon ? (
                      <Emoji emoji={icon} size="1em" />
                    ) : IconComponent ? (
                      <IconComponent className="size-full" />
                    ) : null}
                  </div>
                  <span className="truncate">{name}</span>
                </div>
                {projectName && (
                  <div className="w-full truncate ps-6 text-xs text-muted-foreground">
                    {projectName}
                  </div>
                )}
              </CommandItem>
            );
          })}
        </CommandGroup>
      ))}
    </>
  );
};

/** The palette's tail: the theme switch, and the way into every setting for a signed-in user. */
export const PaletteExtras = ({ search, onClose }: { search?: string; onClose: () => void }) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const theme = useTheme();
  const setting = useSettingStore();
  const isAnonymous = useIsAnonymous();
  const isReadOnlyPreview = useIsReadOnlyPreview();
  const themes = [
    { value: 'light', label: t('common:settings.setting.light'), Icon: Sun },
    { value: 'dark', label: t('common:settings.setting.dark'), Icon: Moon },
    { value: 'system', label: t('common:settings.setting.system'), Icon: LaptopIcon },
  ].filter(({ label }) => matches(label, search));
  const settingsLabel = t('common:settings.allSetting');
  const showSettings = !isAnonymous && !isReadOnlyPreview && matches(settingsLabel, search);
  return (
    <>
      {themes.length > 0 && (
        <>
          <CommandSeparator />
          <CommandGroup heading={t('common:settings.setting.theme')}>
            {themes.map(({ value, label, Icon }) => (
              <CommandItem
                key={value}
                className={ITEM_CLASS}
                onSelect={() => {
                  onClose();
                  theme.setTheme(value);
                }}
                value={label}
                keywords={[label]}
              >
                <div className={ICON_CLASS}>
                  <Icon className="size-full" />
                </div>
                <span>{label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </>
      )}
      {showSettings && (
        <>
          <CommandSeparator />
          <CommandGroup heading={t('common:settings.nav.settings')}>
            <CommandItem
              className={ITEM_CLASS}
              onSelect={() => {
                onClose();
                setting.setOpen(true);
              }}
              value={settingsLabel}
              keywords={[settingsLabel]}
            >
              <div className={ICON_CLASS}>
                <Settings className="size-full" />
              </div>
              <span>{settingsLabel}</span>
            </CommandItem>
          </CommandGroup>
        </>
      )}
    </>
  );
};
