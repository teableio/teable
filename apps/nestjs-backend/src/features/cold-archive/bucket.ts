export interface IPartBucket {
  yyyymm: string;
  kind: 'day' | 'month';
  /** two digit day, only for kind=day */
  dd?: string;
}

export const bucketOfDate = (date: Date, kind: 'day' | 'month'): IPartBucket => {
  const yyyymm = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  if (kind === 'month') return { yyyymm, kind };
  return { yyyymm, kind, dd: String(date.getUTCDate()).padStart(2, '0') };
};

export const bucketId = (bucket: IPartBucket) =>
  bucket.kind === 'month' ? `${bucket.yyyymm}/m` : `${bucket.yyyymm}/${bucket.dd}`;

export const padSeq = (seq: number) => String(seq).padStart(4, '0');
