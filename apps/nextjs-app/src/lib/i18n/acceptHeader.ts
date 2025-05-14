/**
 * From NextJS source code
 * https://github.com/vercel/next.js/blob/ef81fc3f8d/packages/next/server/accept-header.ts
 */

interface ISelection {
  pos: number;
  pref?: number;
  q: number;
  token: string;
}

interface IOptions {
  prefixMatch?: boolean;
  type: 'accept-language';
}

// eslint-disable-next-line sonarjs/cognitive-complexity
function parse(raw: string, preferences: string[] | undefined, options: IOptions) {
  const lowers = new Map<string, { orig: string; pos: number }>();
  const header = raw.replace(/[ \t]/g, '');

  if (preferences) {
    let pos = 0;
    for (const preference of preferences) {
      const lower = preference.toLowerCase();
      lowers.set(lower, { orig: preference, pos: pos++ });
      if (options.prefixMatch) {
        const parts = lower.split('-');
        while ((parts.pop(), parts.length > 0)) {
          const joined = parts.join('-');
          if (!lowers.has(joined)) {
            lowers.set(joined, { orig: preference, pos: pos++ });
          }
        }
      }
    }
  }

  const parts = header.split(',');
  const selections: ISelection[] = [];
  const map = new Set<string>();
  const fallbackLocales: string[] = [];
  for (let i = 0; i < parts.length; ++i) {
    const part = parts[i];
    if (!part) {
      continue;
    }
    const prefix = part.split('-')[0];
    if (prefix && lowers.has(prefix)) {
      fallbackLocales.push(prefix);
    }

    const params = part.split(';');
    if (params.length > 2) {
      throw new Error(`Invalid ${options.type} header`);
    }

    const token = params[0].toLowerCase();
    if (!token) {
      throw new Error(`Invalid ${options.type} header`);
    }

    const selection: ISelection = { token, pos: i, q: 1 };
    if (preferences && lowers.has(token)) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      selection.pref = lowers.get(token)!.pos;
    }

    map.add(selection.token);

    if (params.length === 2) {
      const q = params[1];
      const [key, value] = q.split('=');

      if (!value || (key !== 'q' && key !== 'Q')) {
        throw new Error(`Invalid ${options.type} header`);
      }

      const score = parseFloat(value);
      if (score === 0) {
        continue;
      }

      if (Number.isFinite(score) && score <= 1 && score >= 0.001) {
        selection.q = score;
      }
    }

    selections.push(selection);
  }

  selections.sort((a, b) => {
    if (b.q !== a.q) {
      return b.q - a.q;
    }

    if (b.pref !== a.pref) {
      if (a.pref === undefined) {
        return 1;
      }

      if (b.pref === undefined) {
        return -1;
      }

      return a.pref - b.pref;
    }

    return a.pos - b.pos;
  });

  const values = selections.map((selection) => selection.token);
  if (!preferences || !preferences.length) {
    return values;
  }

  const preferred: string[] = [];
  for (const selection of values) {
    if (selection === '*') {
      for (const [preference, value] of lowers) {
        if (!map.has(preference)) {
          preferred.push(value.orig);
        }
      }
    } else {
      const lower = selection.toLowerCase();
      if (lowers.has(lower)) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        preferred.push(lowers.get(lower)!.orig);
      }
    }
  }

  return preferred.length ? preferred : fallbackLocales;
}

export function acceptLanguage(header = '', preferences?: string[]) {
  return (
    parse(header, preferences, {
      type: 'accept-language',
      prefixMatch: true,
    })[0] || ''
  );
}
