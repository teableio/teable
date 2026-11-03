/**
 * `base.name` is nullable: null means nobody (person or AI) has named the base yet.
 * Server-side text that embeds the name (mail subjects, export manifests, admin lists,
 * agent context) falls back to this English placeholder. Where the recipient's language
 * is known (mail), translate `common.untitledBase` instead.
 */
export const UNTITLED_BASE_NAME = 'Untitled project';

export const baseDisplayName = (name: string | null | undefined): string =>
  name?.trim() || UNTITLED_BASE_NAME;
