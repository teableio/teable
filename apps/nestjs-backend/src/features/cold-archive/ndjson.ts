import type { Readable } from 'node:stream';

const NEWLINE = 0x0a;

/**
 * Split a byte stream into NDJSON lines WITHOUT node:readline.
 *
 * readline flattens its growing internal ConsString and runs a line-ending
 * regex on every chunk, so one multi-megabyte line (a cold row whose payload
 * JSON is tens of MB — real on the ai fleet) becomes an O(n^2) rope-flatten
 * storm. That OOM'd the 2026-07-08 cold drain. Here partial chunks accumulate
 * in an array and concatenate exactly once, when the newline arrives.
 */
export async function* iterateNdjsonLines(stream: Readable): AsyncGenerator<string> {
  const pending: Buffer[] = [];
  let pendingLen = 0;
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      let start = 0;
      let nl = chunk.indexOf(NEWLINE, start);
      while (nl !== -1) {
        const slice = chunk.subarray(start, nl);
        let line: Buffer;
        if (pendingLen > 0) {
          pending.push(slice);
          line = Buffer.concat(pending, pendingLen + slice.length);
          pending.length = 0;
          pendingLen = 0;
        } else {
          line = slice;
        }
        if (line.length > 0) yield line.toString('utf8');
        start = nl + 1;
        nl = chunk.indexOf(NEWLINE, start);
      }
      if (start < chunk.length) {
        // copy: the source buffer may be recycled before the next iteration
        const rest = Buffer.from(chunk.subarray(start));
        pending.push(rest);
        pendingLen += rest.length;
      }
    }
    if (pendingLen > 0) {
      const line = Buffer.concat(pending, pendingLen).toString('utf8');
      if (line.length > 0) yield line;
    }
  } finally {
    stream.destroy();
  }
}
