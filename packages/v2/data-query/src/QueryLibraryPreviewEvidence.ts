import { createHash } from 'node:crypto';

export interface IQueryLibraryEvidenceSourceFile {
  path: string;
  content: string;
  encoding?: string;
}

export interface IQueryLibraryPin {
  id: string;
  revision: number;
}

export function queryLibrarySourceDigest(
  files: readonly IQueryLibraryEvidenceSourceFile[]
): string {
  const ordered = [...files].sort((a, b) => a.path.localeCompare(b.path));
  if (new Set(ordered.map((file) => file.path)).size !== ordered.length) {
    throw new Error('Duplicate source paths');
  }
  return createHash('sha256')
    .update(
      JSON.stringify(
        ordered.map(({ path, content, encoding }) => [path, encoding ?? null, content])
      )
    )
    .digest('hex');
}

export function queryLibraryPreviewEvidenceKey(input: {
  baseId: string;
  appId: string;
  localName: string;
  pin: IQueryLibraryPin;
  sourceDigest: string;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        input.baseId,
        input.appId,
        input.localName,
        input.pin.id,
        input.pin.revision,
        input.sourceDigest,
      ])
    )
    .digest('hex');
}

export function queryLibraryPinNeedsPreview(
  candidate: IQueryLibraryPin,
  published: IQueryLibraryPin | undefined,
  candidateDigest: string,
  publishedDigest: string | undefined
): boolean {
  return (
    !published ||
    published.id !== candidate.id ||
    published.revision !== candidate.revision ||
    publishedDigest !== candidateDigest
  );
}
