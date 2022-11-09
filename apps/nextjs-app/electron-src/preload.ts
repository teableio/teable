/* eslint-disable @typescript-eslint/no-namespace */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { IpcRenderer } from 'electron';
import { ipcRenderer } from 'electron';

declare global {
  // eslint-disable-next-line no-var
  var ipcRenderer: IpcRenderer;
}

// Since we disabled nodeIntegration we can reintroduce
// needed node functionality here
process.once('loaded', () => {
  global.ipcRenderer = ipcRenderer;
});
