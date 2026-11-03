import { UploadType } from '@teable/openapi';
import StorageAdapter from '../../attachments/plugins/adapter';

const LINK_TTL_PATTERN = /-ttl(\d+)\.[^./]+$/;

/**
 * Key for an exported file under `export-base/`. The lifetime its download link is signed
 * with is part of the key, so the cleanup honours what each export was actually given even
 * after BACKEND_STORAGE_TOKEN_EXPIRE_IN changes. Sign the link with the same value.
 */
export const exportBaseObjectPath = (name: string, suffix: string, linkExpiresIn: number) =>
  `${StorageAdapter.getDir(UploadType.ExportBase)}/${name}-ttl${linkExpiresIn}.${suffix}`;

/** link lifetime in seconds recorded by `exportBaseObjectPath`; undefined for older keys */
export const parseExportLinkExpiresIn = (key: string): number | undefined => {
  const match = LINK_TTL_PATTERN.exec(key);
  return match ? Number(match[1]) : undefined;
};
