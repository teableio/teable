import type { IGetBaseVo } from '@teable/openapi';
import { act, render, renderHook, screen } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TemplateHostContext,
  type ITemplateHost,
  type ITemplateProjectHost,
} from '../../components/space/template/host-context';
import { useProjectListTabs } from './useProjectListTabs';

vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const base = (id: string) => ({ id, name: id, spaceId: 'spc1' }) as IGetBaseVo;
const bases = ['infra', 'crm', 'nda', 'ndaTrial'].map(base);

const projectHost = (known = true): ITemplateProjectHost =>
  ({
    useSpaceProjects: () =>
      known ? { projectIds: new Set(['nda']), trialOf: new Map([['ndaTrial', 'nda']]) } : undefined,
    renderRowBadges: (item: { id: string }) => <span>badges:{item.id}</span>,
    renderCreateProject: ({ open }: { open: boolean }) => <div>create-dialog:{String(open)}</div>,
  }) as unknown as ITemplateProjectHost;

const renderTabs = (host: ITemplateHost) =>
  renderHook(() => useProjectListTabs({ spaceId: 'spc1', bases, canCreate: true }), {
    wrapper: ({ children }: PropsWithChildren) => (
      <TemplateHostContext.Provider value={host}>{children}</TemplateHostContext.Provider>
    ),
  });

const ids = (list: IGetBaseVo[] | undefined) => list?.map((item) => item.id);
const openTemplatesTab = async (toolbar: React.ReactNode) => {
  render(<>{toolbar}</>);
  await act(async () => {
    const tab = screen.getByRole('tab', { name: /space:templateProject.plural/ });
    tab.focus();
    tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
  });
};

describe('useProjectListTabs', () => {
  afterEach(() => document.body.replaceChildren());

  it('leaves the list as one list where nothing makes templates in template projects', () => {
    const { result } = renderTabs({});

    expect(ids(result.current.bases)).toEqual(['infra', 'crm', 'nda', 'ndaTrial']);
    expect(result.current.listProps).toEqual({});
    expect(result.current.createAction).toBeUndefined();
    expect(result.current.createDialog).toBeNull();
  });

  it('leaves it as one list until the space says which projects are template projects', () => {
    const { result } = renderTabs({ project: projectHost(false) });

    expect(ids(result.current.bases)).toEqual(['infra', 'crm', 'nda', 'ndaTrial']);
    expect(result.current.listProps).toEqual({});
  });

  it('keeps template projects and their trial copies out of the projects people work in', () => {
    const { result } = renderTabs({ project: projectHost() });

    expect(ids(result.current.bases)).toEqual(['infra', 'crm']);
    expect(result.current.createAction).toBeUndefined();
    render(<>{result.current.listProps.toolbarStart}</>);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'space:templateProject.projectsTab2',
      'space:templateProject.plural1',
    ]);
  });

  it('lists template projects on their own tab, each with its trial copies and a way to start one', async () => {
    const { result } = renderTabs({ project: projectHost() });
    await openTemplatesTab(result.current.listProps.toolbarStart);

    const { bases: listed, listProps, createAction } = result.current;
    expect(ids(listed)).toEqual(['nda']);
    expect(listProps.title).toBe('space:templateProject.plural');
    expect(listProps.templateProjectIds?.has('nda')).toBe(true);
    expect(ids(listProps.trialCopiesOf?.('nda'))).toEqual(['ndaTrial']);
    expect(ids(listProps.trialCopiesOf?.('infra'))).toEqual([]);
    expect(createAction?.label).toBe('space:templateProject.new');

    render(<>{listProps.renderNameExtra?.(bases[2])}</>);
    expect(screen.getByText('badges:nda')).toBeTruthy();

    // The create button on this tab starts a template project, not a project.
    act(() => createAction?.onClick());
    render(<>{result.current.createDialog}</>);
    expect(screen.getByText('create-dialog:true')).toBeTruthy();
  });
});
