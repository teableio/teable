import { z } from '../zod';

/** The part of a public URL that names a template or a category: lowercase words joined by hyphens. */
export const URL_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const URL_KEY_MAX_LENGTH = 64;

export const urlKeySchema = z.string().regex(URL_KEY_PATTERN).max(URL_KEY_MAX_LENGTH);
