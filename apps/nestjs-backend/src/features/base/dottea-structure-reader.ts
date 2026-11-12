import type { Readable } from 'node:stream';
import { parserStream } from 'stream-json';
import { streamValues } from 'stream-json/streamers/stream-values.js';
import * as unzipper from 'unzipper';

/** The archive itself is unusable: not a zip, no structure.json, or one that does not parse. */
export class DotTeaStructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DotTeaStructureError';
  }
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Read `structure.json` out of a .tea archive and settle as soon as the answer
 * is known: the parsed value, or the first error from any stage.
 *
 * `pipe()` forwards data but not errors, so every stage is watched here. An
 * unwatched JSON parser raises its error as an uncaught exception and leaves
 * the read waiting on the rest of the archive. The listeners stay attached
 * after settling, because destroying `zipStream` early can still make a
 * half-read stage fail.
 *
 * A problem with the file rejects with `DotTeaStructureError`; a failure of
 * `zipStream` itself (storage, network) rejects with that stream's own error,
 * so callers can tell a bad file from an unavailable one. The stream is left
 * unpiped, not destroyed: the caller owns it.
 */
export const readDotTeaStructureJson = (zipStream: Readable): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const zipParser = unzipper.Parse();
    let structureEntrySeen = false;
    let settled = false;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      zipStream.unpipe(zipParser);
      finish();
    };
    const failFile = (error: unknown) =>
      settle(() => reject(new DotTeaStructureError(describe(error))));

    zipParser.on('entry', (entry: unzipper.Entry) => {
      if (settled || structureEntrySeen || entry.path !== 'structure.json') {
        entry.autodrain().on('error', failFile);
        return;
      }
      structureEntrySeen = true;

      const jsonParser = parserStream();
      const values = streamValues.asStream();
      entry.on('error', failFile);
      jsonParser.on('error', (error: Error) =>
        failFile(`structure.json is not valid JSON: ${error.message}`)
      );
      values
        .on('error', failFile)
        .on('data', (data: { value: unknown }) => settle(() => resolve(data.value)))
        .on('end', () => failFile('structure.json is empty'));
      entry.pipe(jsonParser).pipe(values);
    });
    zipParser.on('error', failFile);
    zipParser.on('finish', () => {
      // With the entry seen, its own JSON stages report the outcome.
      if (!structureEntrySeen) failFile('structure.json not found in dottea file');
    });

    zipStream.on('error', (error) => settle(() => reject(error)));
    zipStream.pipe(zipParser);
  });
