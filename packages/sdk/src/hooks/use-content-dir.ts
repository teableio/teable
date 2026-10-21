import { useContext } from 'react';
import { AppContext } from '../context/app/AppContext';
import { isRtlLang } from '../utils/text-direction';

/**
 * Direction for *displaying* a piece of stored content — a table name, a cell
 * value, someone else's comment.
 *
 * Deliberately not for the fields a reader types into. Those follow the
 * document: the reader picked Arabic, so Arabic is the frame they read in, and
 * a guess from the first character can only disagree with a choice they already
 * made — badly, when a sentence of theirs opens with an English table name.
 * Displayed content is the opposite case: the items sit side by side, each
 * written by someone else in a language nobody declared, so each has to say
 * which way it reads. Returns `undefined` outside RTL UI languages, leaving the
 * rendered DOM byte-identical to what every other locale already gets.
 *
 * The grid's cell editor is the one editor that still takes this: it covers a
 * canvas cell that was painted by content direction, and text that changed
 * sides on click would be worse than either rule applied consistently.
 *
 * Reads `AppContext` directly instead of going through `useTranslation`, which
 * destructures it: some surfaces mount their own React root (the editor's
 * mention popup does) and see no provider at all. A component that never asked
 * for translations must not start throwing just because it now labels the
 * direction of its text, so a missing provider degrades to "leave it alone".
 */
export const useContentDir = (): 'auto' | undefined => {
  const app = useContext(AppContext);
  return isRtlLang(app?.lang) ? 'auto' : undefined;
};
