import type { QueryClient } from '@tanstack/react-query';
import type {
  IGetBaseVo,
  IPublishBaseRo,
  ITemplateReview,
  ITemplateVo,
  TemplateListSort,
} from '@teable/openapi';
import React, { useContext } from 'react';

export enum TemplateHostInstallSource {
  Catalog = 'catalog',
  Share = 'share',
  Chat = 'chat',
  /** A link into the app, such as the template site's Use template. */
  Public = 'public',
}

export interface ITemplateInstallArgs {
  templateId: string;
  spaceId: string;
  /** The project the user is in, offered as the place to add the template to. */
  baseId?: string;
  source: TemplateHostInstallSource;
  /** The caller's client: the host's dialog mounts above every provider and reads and invalidates through this one. */
  queryClient: QueryClient;
}

export interface ITemplateInstallResult {
  /** Where to send the user now that the template is in place. */
  redirect: string;
  /** The base the template landed in. */
  baseId: string;
  /** Something still has to be set up before it runs; `redirect` is that screen. */
  needsSetup?: boolean;
}

export type ITemplateSubmitRo = IPublishBaseRo & {
  changelog?: string;
  /** The host's terms for publishing, agreed in the dialog (EE: the creator terms). */
  agreeTerms?: boolean;
};

/** Terms the author agrees to before publishing, drawn by the publish button. */
export interface ITemplateSubmitTerms {
  /** What to agree to; null when there is nothing to agree to. */
  panel: React.ReactNode;
  /** Publishing waits for the terms to be agreed, or for whether they need to be to be known. */
  blocked: boolean;
  /** Sent with the submission, which keeps the agreement. */
  agreed: boolean;
}

export interface ITemplateSubmitResult {
  templateId: string;
  review: ITemplateReview;
}

/** Publishing goes through a review queue instead of straight to the catalogue. */
export interface ITemplateSubmissionHost {
  submit: (baseId: string, ro: ITemplateSubmitRo) => Promise<ITemplateSubmitResult>;
  withdraw: (templateId: string) => Promise<void>;
  /** Under the live status of a listing (EE: a nudge to set up payouts). */
  renderStatusExtra?: (template: ITemplateVo) => React.ReactNode;
  /**
   * A row in the publish form (EE: the post-install guide, drafted and edited in the project).
   * `close` shuts the dialog so the author can work in the project.
   */
  renderGuideRow?: (args: {
    baseId: string;
    includeData: boolean;
    close: () => void;
  }) => React.ReactNode;
  /** Replaces the default share buttons for a listing that is live or under review (EE: the share card). */
  renderShareActions?: (args: { template: ITemplateVo; shareUrl: string }) => React.ReactNode;
  /** A hook: terms to agree to before publishing (EE: the creator terms, the first time). */
  useTerms?: (open: boolean) => ITemplateSubmitTerms;
}

/** What a project is to the template centre, as the host knows it. */
export interface ITemplateProjectInfo {
  /** Made to become a template: it lists apart from the projects people work in, and is submitted whole. */
  isTemplateProject: boolean;
  /** A trial copy of a template project: what an install gets, not something to publish from. */
  isTrialCopy: boolean;
  /** An ordinary project published before template projects existed: it keeps its publish entry. */
  hasListing: boolean;
}

/** A space's template projects, for a project list to set them apart. */
export interface ISpaceTemplateProjects {
  projectIds: ReadonlySet<string>;
  /** Trial copy to the template project it was copied from: a trial lists under its project. */
  trialOf: ReadonlyMap<string, string>;
}

/** What the submit dialog of a template project shows in place of what it has no need to ask. */
export interface ITemplateProjectSubmitState {
  /** Tables, apps and automations in the project: all of them go out. Undefined while loading. */
  items?: number;
  /** Records in its tables: they ship as the template's samples. */
  records?: number;
  /** The checks found something that stops a submission. */
  blocked: boolean;
  /** The checks, drawn in the dialog's side column while nothing is under review. */
  panel: React.ReactNode;
  /**
   * The same checks on the publish page: lines of the next version's checklist (`<li>`s), each
   * with what the author does about it.
   */
  rows?: React.ReactNode;
  /** What the template carries, for the publish page's side column. */
  contents?: React.ReactNode;
}

export type ITemplateProjectBase = Pick<IGetBaseVo, 'id' | 'name' | 'spaceId'>;

/**
 * Templates are made in template projects (EE). A project in use is only where one is
 * extracted from: its publish entry becomes "Make a template", and what gets submitted is
 * the template project. Every `use*` member is a hook.
 */
export interface ITemplateProjectHost {
  /** Undefined until known. */
  useInfo: (baseId: string, enabled?: boolean) => ITemplateProjectInfo | undefined;
  /** Undefined until known, and for a space the user cannot list. */
  useSpaceProjects: (spaceId: string | undefined) => ISpaceTemplateProjects | undefined;
  /** After the project's name where it heads the page: the mark of a template project. */
  renderTag: (baseId: string) => React.ReactNode;
  /** Under the sidebar header: where the template stands, and the way to try and submit it. */
  renderSidebarBlock: (base: IGetBaseVo) => React.ReactNode;
  /** After a template project's name in a list row: where its listing stands. */
  renderRowBadges: (base: ITemplateProjectBase) => React.ReactNode;
  /** The dialog that makes a template project out of part of a project, starting from a node. */
  renderMakeTemplate: (args: {
    base: ITemplateProjectBase;
    nodeId?: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => React.ReactNode;
  /** The dialog that starts an empty template project. */
  renderCreateProject: (args: {
    spaceId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => React.ReactNode;
  /** `close` shuts the dialog so the author can fix what a check found in the project. */
  useSubmitState: (
    baseId: string,
    enabled: boolean,
    close: () => void
  ) => ITemplateProjectSubmitState;
  /** What deleting the project does to its listing, said before it happens. */
  useDeleteNotice: (
    baseId: string,
    enabled: boolean
  ) => { lines: string[]; confirmLabel?: string } | undefined;
}

/**
 * What the host app layers onto the template centre. Every template renders the
 * same card and detail; a host can add to them (EE shows a template's integration
 * logos and its "connects to" panel) and own how a template is applied (EE installs
 * it as a template, asking where it goes first). Each hook returns `undefined` /
 * `null` to keep the default for that template.
 */
export interface ITemplateHost {
  /** Rendered over the card's cover, bottom-start corner (EE: the services the template connects to). */
  renderCoverOverlay?: (template: ITemplateVo) => React.ReactNode;
  /** The row under the card's description; undefined keeps the view count. */
  renderCardFooter?: (template: ITemplateVo) => React.ReactNode;
  /** Rendered in the detail's side column, between the install button and the facts. */
  renderDetailSidebar?: (template: ITemplateVo) => React.ReactNode;
  /**
   * Applies the template; resolves undefined when the user backs out. Absent, the
   * template is copied into a new base and the user lands on it.
   */
  install?: (args: ITemplateInstallArgs) => Promise<ITemplateInstallResult | undefined>;
  /** Absent, the publish dialog publishes the base straight away. */
  submission?: ITemplateSubmissionHost;
  /** Absent, any project publishes itself. */
  project?: ITemplateProjectHost;
  catalogSort?: TemplateListSort;
}

export const TemplateHostContext = React.createContext<ITemplateHost>({});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const useNothing = (..._args: unknown[]) => undefined;

/** A project's place in the template centre; undefined without a host for it, or until known. */
export const useTemplateProjectInfo = (baseId: string, enabled = true) => {
  const useInfo = useContext(TemplateHostContext).project?.useInfo ?? useNothing;
  return useInfo(baseId, enabled);
};

export const useSpaceTemplateProjects = (spaceId: string | undefined) => {
  const useSpaceProjects = useContext(TemplateHostContext).project?.useSpaceProjects ?? useNothing;
  return useSpaceProjects(spaceId);
};

const NO_SUBMIT_STATE: ITemplateProjectSubmitState = { blocked: false, panel: null };
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const useNoSubmitState = (..._args: unknown[]) => NO_SUBMIT_STATE;

export const useTemplateProjectSubmitState = (
  baseId: string,
  enabled: boolean,
  close: () => void
) => {
  const useSubmitState =
    useContext(TemplateHostContext).project?.useSubmitState ?? useNoSubmitState;
  return useSubmitState(baseId, enabled, close);
};

const NO_TERMS: ITemplateSubmitTerms = { panel: null, blocked: false, agreed: false };
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const useNoTerms = (..._args: unknown[]) => NO_TERMS;

/** What the author agrees to before publishing; nothing without a host that asks. */
export const useTemplateSubmitTerms = (open: boolean) => {
  const useTerms = useContext(TemplateHostContext).submission?.useTerms ?? useNoTerms;
  return useTerms(open);
};

export const useTemplateProjectDeleteNotice = (baseId: string, enabled: boolean) => {
  const useDeleteNotice = useContext(TemplateHostContext).project?.useDeleteNotice ?? useNothing;
  return useDeleteNotice(baseId, enabled);
};
