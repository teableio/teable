// Avatar URLs belong to the read model, not the deployment-independent user snapshot.
export const serializeUserCellValue = (value: unknown): string | null =>
  value == null
    ? null
    : JSON.stringify(value, (key, item: unknown) => (key === 'avatarUrl' ? undefined : item));
