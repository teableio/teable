import { DriverClient } from '@teable-group/core';

export function getDriver(): DriverClient {
  if (typeof window === 'object') {
    return (window.__s?.driver as DriverClient) || DriverClient.Sqlite;
  }
  return DriverClient.Sqlite;
}
