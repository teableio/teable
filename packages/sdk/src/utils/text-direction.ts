export type ITextDirection = 'ltr' | 'rtl';

/**
 * UI languages whose users get content-level direction handling.
 *
 * The gate exists purely to bound the blast radius of the first rollout — both
 * `dir="auto"` and first-strong detection render LTR content identically with
 * or without it. Widening this set (or dropping the gate) is all that is needed
 * to also cover users who read the UI in English but enter RTL content.
 *
 * `he` was listed here ahead of the locale itself; the Hebrew translation now
 * ships, so both entries are live.
 */
const RTL_LANGS = new Set(['ar', 'he']);

export const isRtlLang = (lang?: string) => Boolean(lang && RTL_LANGS.has(lang.split('-')[0]));

/**
 * Right-to-left scripts. Matched by script rather than by Bidi_Class because JS
 * regexes expose `\p{Script=...}` but not `\p{Bidi_Class=...}`.
 */
const RTL_SCRIPT =
  /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}\p{Script=Samaritan}\p{Script=Mandaic}]/u;

/** First character carrying a strong direction — the same signal `dir="auto"` uses. */
const FIRST_STRONG = /[\p{L}\p{Nl}]/u;

/**
 * Resolve the base direction of a string from its first strong character,
 * mirroring the semantics of the native `dir="auto"` attribute.
 *
 * Returns `null` when the text carries no directional signal at all (digits,
 * punctuation, empty), in which case callers should leave direction untouched.
 */
export const detectTextDirection = (text: string): ITextDirection | null => {
  const strong = FIRST_STRONG.exec(text);
  if (strong == null) return null;
  return RTL_SCRIPT.test(strong[0]) ? 'rtl' : 'ltr';
};

/**
 * Canvas renderers are plain functions drawing outside the React tree, so the
 * language gate is mirrored into a module-level flag that `AppProvider` sets on
 * the client. While it is off, the renderers skip direction detection entirely.
 */
let contentDirectionEnabled = false;

export const setContentDirectionEnabled = (enabled: boolean) => {
  contentDirectionEnabled = enabled;
};

export const isContentDirectionEnabled = () => contentDirectionEnabled;
