/* eslint-disable @typescript-eslint/naming-convention */
import type { IActionTriggerBuffer } from '@teable-group/core';
import React from 'react';

export const ActionTriggerContext = React.createContext<IActionTriggerBuffer | null>(null);
