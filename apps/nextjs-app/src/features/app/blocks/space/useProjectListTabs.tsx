import { Plus } from '@teable/icons';
import type { IGetBaseVo } from '@teable/openapi';
import { Tabs, TabsList, TabsTrigger } from '@teable/ui-lib/shadcn';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import { useTranslation } from 'next-i18next';
import { useContext, useEffect, useMemo, useState } from 'react';
import { spaceConfig } from '@/features/i18n/space.config';
import {
  TemplateHostContext,
  useSpaceTemplateProjects,
} from '../../components/space/template/host-context';

enum ListTab {
  Projects = 'projects',
  Templates = 'templates',
}

const TAB_TRIGGER = 'h-6 gap-1.5 px-2 text-xs';

const TabCount = ({ count }: { count: number }) => (
  <span className="tabular-nums text-muted-foreground">{count}</span>
);

/** The projects of a space, split into the ones people work in and the template projects. */
const splitBases = (
  bases: IGetBaseVo[],
  projectIds: ReadonlySet<string> | undefined,
  trialOf: ReadonlyMap<string, string> | undefined
) => ({
  // A trial copy lists under the template project it was made from, not among the projects.
  projects: bases.filter((base) => !projectIds?.has(base.id) && !trialOf?.has(base.id)),
  templates: bases.filter((base) => projectIds?.has(base.id)),
  trialCopiesOf: (baseId: string) => bases.filter((base) => trialOf?.get(base.id) === baseId),
});

/**
 * Where templates are made in template projects, a space lists them apart from the projects
 * people work in: two tabs over the list, the template tab with each listing's state after
 * the name, its trial copies under it, and a create button that starts a template project.
 * Without a host for template projects the list is the one list it always was.
 */
export const useProjectListTabs = ({
  spaceId,
  bases,
  canCreate,
}: {
  spaceId: string;
  bases: IGetBaseVo[] | undefined;
  canCreate: boolean;
}) => {
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const { project: host } = useContext(TemplateHostContext);
  const spaceProjects = useSpaceTemplateProjects(spaceId);
  const [tab, setTab] = useState(ListTab.Projects);
  const [createOpen, setCreateOpen] = useState(false);
  useEffect(() => setTab(ListTab.Projects), [spaceId]);

  const { projects, templates, trialCopiesOf } = useMemo(
    () => splitBases(bases ?? [], spaceProjects?.projectIds, spaceProjects?.trialOf),
    [bases, spaceProjects]
  );
  if (!host || !spaceProjects) {
    return { bases, listProps: {}, createAction: undefined, createDialog: null };
  }

  const tabs = (
    <Tabs value={tab} onValueChange={(value) => setTab(value as ListTab)}>
      <TabsList className="h-8">
        <TabsTrigger value={ListTab.Projects} className={TAB_TRIGGER}>
          {t('space:templateProject.projectsTab')}
          <TabCount count={projects.length} />
        </TabsTrigger>
        <TabsTrigger value={ListTab.Templates} className={TAB_TRIGGER}>
          {t('space:templateProject.plural')}
          <TabCount count={templates.length} />
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
  const createDialog = host.renderCreateProject({
    spaceId,
    open: createOpen,
    onOpenChange: setCreateOpen,
  });
  if (tab === ListTab.Projects) {
    return {
      bases: projects,
      listProps: { toolbarStart: tabs },
      createAction: undefined,
      createDialog,
    };
  }

  const startProject = () => setCreateOpen(true);
  return {
    bases: templates,
    listProps: {
      toolbarStart: tabs,
      title: t('space:templateProject.plural'),
      templateProjectIds: spaceProjects.projectIds,
      renderNameExtra: (base: IGetBaseVo) => host.renderRowBadges(base),
      trialCopiesOf,
      emptyContent: (
        <div className="flex flex-col items-center gap-3 py-16 text-sm text-muted-foreground">
          <p>{t('space:templateProject.empty')}</p>
          {canCreate && (
            <Button variant="outline" size="sm" onClick={startProject}>
              <Plus className="size-4" />
              {t('space:templateProject.new')}
            </Button>
          )}
        </div>
      ),
    },
    createAction: { label: t('space:templateProject.new'), onClick: startProject },
    createDialog,
  };
};
