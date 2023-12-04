/* eslint-disable @typescript-eslint/naming-convention */
import type { INotificationSocketVo } from '@teable-group/core';
import React from 'react';

export const NotificationContext = React.createContext<INotificationSocketVo | null>(null);
