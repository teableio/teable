import type { QueryClient } from '@tanstack/react-query';
import type {
  IPublishBaseRo,
  ITemplateReview,
  ITemplateVo,
  TemplateListSort,
} from '@teable/openapi';
import React from 'react';

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

export type ITemplateSubmitRo = IPublishBaseRo & { changelog?: string };

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
  catalogSort?: TemplateListSort;
}

export const TemplateHostContext = React.createContext<ITemplateHost>({});
