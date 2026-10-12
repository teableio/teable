export type CsvReplayStore = {
  /** Append one bounded decoded-text chunk, preserving UTF-16 code units exactly. */
  append(text: string): Promise<void>;
  /** Replay committed chunks in append order without accumulating them. */
  read(): AsyncIterable<string>;
  /** Idempotently close and remove this request's temporary storage. */
  dispose(): Promise<void>;
};
