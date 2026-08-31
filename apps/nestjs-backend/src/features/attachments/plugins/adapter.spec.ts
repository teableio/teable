import { UploadType } from '@teable/openapi';
import StorageAdapter from './adapter';

describe('StorageAdapter.getCacheControl', () => {
  const immutable = 'public, max-age=31536000, immutable';
  const oneHour = 'public, max-age=3600';

  it.each([
    [UploadType.Template, immutable],
    [UploadType.Form, immutable],
    [UploadType.OAuth, immutable],
    [UploadType.ChatDataVisualizationCode, immutable],
    [UploadType.Avatar, oneHour],
    [UploadType.SpaceAvatar, oneHour],
    [UploadType.Logo, oneHour],
    [UploadType.Plugin, oneHour],
  ])('public type %s gets %s', (type, expected) => {
    expect(StorageAdapter.getCacheControl(type)).toBe(expected);
  });

  it.each([
    [UploadType.Table],
    [UploadType.Comment],
    [UploadType.ChatFile],
    [UploadType.Import],
    [UploadType.ExportBase],
    [UploadType.App],
    [UploadType.Automation],
    [UploadType.RecordHistory],
    [UploadType.RecordRemoval],
    [UploadType.WorkflowRunCold],
    [UploadType.AuditLogCold],
  ])('private-bucket type %s gets no object-level cache-control', (type) => {
    expect(StorageAdapter.getCacheControl(type)).toBeUndefined();
  });
});
