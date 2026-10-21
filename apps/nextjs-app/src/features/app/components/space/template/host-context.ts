import type { ICreateBaseFromTemplateVo, ITemplateVo } from '@teable/openapi';
import React from 'react';

export interface ITemplateUseOptions {
  /** Copy the snapshot's rows into the new base. Default: true. */
  withRecords?: boolean;
  /** Where to send the user once the base exists. Undefined keeps the default (the template's defaultUrl, else base home). */
  redirect?: (base: ICreateBaseFromTemplateVo) => string | undefined;
}

/**
 * What the host app layers onto the template centre. Every template renders the
 * same card and detail; a host can add to them (EE shows a solution's integration
 * logos and its "connects to" panel) and decide how a template is applied (EE sends
 * a solution to its setup flow instead of the base home). Each hook returns
 * `undefined` / `null` to keep the default for that template.
 */
export interface ITemplateHost {
  /** Rendered over the card's cover, bottom-start corner (EE: the services the template connects to). */
  renderCoverOverlay?: (template: ITemplateVo) => React.ReactNode;
  /** Rendered in the detail between the preview and the markdown description. */
  renderDetailExtra?: (template: ITemplateVo) => React.ReactNode;
  useOptions?: (template: ITemplateVo) => ITemplateUseOptions | undefined;
}

export const TemplateHostContext = React.createContext<ITemplateHost>({});
