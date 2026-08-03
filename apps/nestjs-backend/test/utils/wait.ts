/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Doc } from 'sharedb/lib/client';

export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 8000,
  intervalMs = 50
): Promise<void> {
  const start = Date.now();
  return new Promise<void>((resolve, reject) => {
    const check = () => {
      try {
        if (predicate()) return resolve();
        if (Date.now() - start > timeoutMs)
          return reject(new Error('timeout waiting for condition'));
        setTimeout(check, intervalMs);
      } catch (e) {
        reject(e as Error);
      }
    };
    check();
  });
}

export async function subscribeDocs(docs: Doc<any>[], timeoutMs = 4000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let count = 0;
    const done = () => {
      count++;
      if (count === docs.length) resolve();
    };
    docs.forEach((doc) => doc.subscribe((err) => (err ? reject(err) : done())));
    setTimeout(() => reject(new Error('subscribe timeout')), timeoutMs);
  });
}
