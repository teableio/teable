import { APP_ROBOT_ID } from './app-robot';
import { AUTOMATION_ROBOT_ID } from './automation-robot';

export const SYSTEM_USER_ID = 'system';

// App and automation tokens all resolve to these shared identities
export const isRobot = (userId: string) =>
  userId === APP_ROBOT_ID || userId === AUTOMATION_ROBOT_ID;

export const getPluginEmail = (pluginId: string) => `${pluginId.toLowerCase()}@plugin.teable.ai`;
