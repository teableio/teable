import { Label, Switch } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useContext } from 'react';
import {
  TemplateHostContext,
  useTemplateProjectInfo,
  useTemplateProjectSubmitState,
} from '@/features/app/components/space/template/host-context';
import { NodeTreeSelect } from './NodeTreeSelect';

/**
 * What the publish dialog turns into for a template project. Such a project goes out whole,
 * with the sample records it holds: the form has no scope to pick and no records to leave
 * out, and the checks run before it is published. For any other project nothing here changes
 * the dialog. Where publishing is followed by a review, the review only decides whether the
 * template centre lists the template, and the dialog says so instead of promising a listing.
 */
export const useTemplateProjectPublish = ({
  baseId,
  open,
  close,
}: {
  baseId: string;
  open: boolean;
  close: () => void;
}) => {
  const { t } = useTranslation('space');
  const { project: host, submission } = useContext(TemplateHostContext);
  const info = useTemplateProjectInfo(baseId, open);
  const isTemplateProject = Boolean(host && info?.isTemplateProject);
  const submitState = useTemplateProjectSubmitState(baseId, open && isTemplateProject, close);
  const heading = submission
    ? { title: t('publishBase.configureTitle'), description: t('publishBase.configureDescription') }
    : { title: t('publishBase.title'), description: t('publishBase.description') };
  if (!isTemplateProject) {
    return {
      isTemplateProject,
      // Whether it is a template project is not known yet: its checklist would change shape.
      pending: Boolean(host) && open && info === undefined,
      ...heading,
      records: undefined,
      blocked: false,
      checks: null,
      rows: undefined,
      contents: null,
    };
  }
  return {
    isTemplateProject,
    pending: false,
    ...heading,
    records: submitState.records,
    blocked: submitState.blocked,
    checks: submitState.panel,
    rows: submitState.rows,
    contents: submitState.contents,
  };
};

/** What a submission takes: everything, for a template project; what is ticked, otherwise. */
export const publishScopeOf = <T,>(wholeProject: boolean, all: T, picked: T): T =>
  wholeProject ? all : picked;

/** The "what it includes" cell: the node picker, or for a template project what all goes out. */
export const PublishScopeField = ({
  wholeProject,
  count,
  records,
  checkedItems,
  onCheckedItemsChange,
  totalNodeCount,
}: {
  wholeProject: boolean;
  /** Tables, apps and automations in the project. */
  count: number;
  /** Records in its tables; undefined while it is being counted. */
  records: number | undefined;
  checkedItems: string[];
  onCheckedItemsChange: (ids: string[]) => void;
  totalNodeCount: number;
}) => {
  const { t } = useTranslation(['space', 'common']);
  if (!wholeProject) {
    return (
      <NodeTreeSelect
        showCheckbox
        checkedItems={checkedItems}
        onCheckedItemsChange={onCheckedItemsChange}
        placeholder={t('common:actions.select')}
        totalNodeCount={totalNodeCount}
      />
    );
  }
  return (
    <div className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm">
      <span className="min-w-0 truncate">{t('templateProject.wholeProject', { count })}</span>
      {records !== undefined && (
        <span className="ms-auto shrink-0 text-xs text-muted-foreground">
          {records
            ? t('templateProject.sampleRecords', { count: records })
            : t('templateProject.noRecords')}
        </span>
      )}
    </div>
  );
};

/** The switch that leaves the records out; a template project always ships the ones it holds. */
export const IncludeDataSwitch = ({
  hidden,
  checked,
  onCheckedChange,
}: {
  hidden: boolean;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) => {
  const { t } = useTranslation('space');
  if (hidden) return null;
  return (
    <div className="flex items-center space-x-2 rtl:space-x-reverse">
      <Switch id="include-data" checked={checked} onCheckedChange={onCheckedChange} />
      <Label htmlFor="include-data">{t('publishBase.form.includeData')}</Label>
    </div>
  );
};
