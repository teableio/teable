import React from 'react';

export interface ITemplateContext {
  spaceId?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TemplateContext = React.createContext<ITemplateContext>({});
