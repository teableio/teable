/* eslint-disable @typescript-eslint/naming-convention */
import type { IActionTriggerBuffer } from '@teable/core';
import React from 'react';

export type PropKeys = keyof IActionTriggerBuffer;

export type IActionTrigger = {
  data?: IActionTriggerBuffer;
};

export type IActionTriggerContext = IActionTrigger & {
  listener?: (propKeys: PropKeys[], callback: () => void, deps?: unknown[]) => void;
};

export const ActionTriggerContext = React.createContext<IActionTriggerContext>({});
