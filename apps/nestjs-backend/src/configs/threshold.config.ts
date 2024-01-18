/* eslint-disable @typescript-eslint/naming-convention */
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

export const thresholdConfig = registerAs('threshold', () => ({
  maxCopyCells: Number(process.env.MAX_COPY_CELLS ?? 50_000),
  maxResetCells: Number(process.env.MAX_RESET_CELLS ?? 10_000),
  maxPasteCells: Number(process.env.MAX_PASTE_CELLS ?? 10_000),
  maxReadRows: Number(process.env.MAX_READ_ROWS ?? 10_000),
  maxDeleteRows: Number(process.env.MAX_DELETE_ROWS ?? 1_000),
  maxSyncUpdateCells: Number(process.env.MAX_SYNC_UPDATE_CELLS ?? 10_000),
  maxGroupPoints: Number(process.env.MAX_GROUP_POINTS ?? 5_000),
  calcChunkSize: Number(process.env.CALC_CHUNK_SIZE ?? 1_000),
}));

export const ThresholdConfig = () => Inject(thresholdConfig.KEY);

export type IThresholdConfig = ConfigType<typeof thresholdConfig>;
