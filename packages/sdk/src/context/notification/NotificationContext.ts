/* eslint-disable @typescript-eslint/naming-convention */
import type { INotificationBuffer } from '@teable-group/core';
import React from 'react';

export const NotificationContext = React.createContext<INotificationBuffer | null>(null);
