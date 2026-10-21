// @ts-check

/**
 * Local oxlint JS plugin (`teable/*`) for checks oxlint has no native rule for.
 */

/**
 * Physical direction utilities do not mirror under an RTL interface: the
 * document flips but `pl-2` still means "left". Their logical counterparts
 * (Tailwind >= 3.3) compile to the exact same CSS while the document is LTR, so
 * switching is free for every other locale and correct for Arabic.
 *
 * Deliberately NOT banned, because they are physical on purpose:
 *   - `left-1/2` / `left-[50%]` paired with `-translate-x-1/2` — centering is
 *     direction-agnostic, and the transform half of it has no logical form.
 *   - `slide-in-from-left` / `data-[side=left]` — the animation and Radix's
 *     resolved side are both already physical facts about where a thing landed.
 * Anything genuinely physical that this rule does flag can opt out with a
 * one-line disable comment plus a reason.
 */
const centeringInset = String.raw`(?!1(?![0-9])|\[)`;
const physicalUtility = new RegExp(
  String.raw`(^|\s)-?(?:[\w@[\]&:.-]*:)?(?:` +
    [
      String.raw`p[lr]-`,
      String.raw`m[lr]-`,
      String.raw`scroll-p[lr]-`,
      String.raw`scroll-m[lr]-`,
      String.raw`(?:left|right)-` + centeringInset,
      String.raw`text-(?:left|right)(?![\w-])`,
      String.raw`float-(?:left|right)(?![\w-])`,
      String.raw`rounded-(?:l|r|tl|tr|bl|br)(?:-|(?![\w-]))`,
      String.raw`border-(?:l|r)(?:-|(?![\w-]))`,
    ].join('|') +
    `)`
);

/**
 * These color tokens already carry their own transparency (`--border: 0 0% 0% / 0.08`,
 * and `--accent` in dark mode). An opacity modifier stacks a second alpha, so
 * `border-border/40` compiles to `hsl(0 0% 0% / 0.08 / 0.4)`: invalid, and the
 * property falls back to its initial value (borders turn currentColor, backgrounds
 * transparent).
 */
const alphaTokenWithModifier = new RegExp(
  String.raw`(^|\s)!?(?:\S*:)?!?` +
    String.raw`(?:bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|divide|from|via|to|outline|stroke|fill|shadow|caret|accent|decoration|placeholder)` +
    String.raw`-(?:border|border-high|input|surface|accent)/`
);

/**
 * Reports string literals and template chunks whose text matches `pattern`;
 * class names reach JSX as either.
 * @param {RegExp} pattern
 * @param {string} message
 */
const classNameRule = (pattern, message) => ({
  meta: { type: 'problem', messages: { match: message }, schema: [] },
  /** @param {any} context */
  create(context) {
    return {
      /** @param {any} node */
      Literal(node) {
        if (typeof node.value === 'string' && pattern.test(node.value)) {
          context.report({ node, messageId: 'match' });
        }
      },
      /** @param {any} node */
      TemplateElement(node) {
        if (pattern.test(node.value.raw)) {
          context.report({ node, messageId: 'match' });
        }
      },
    };
  },
});

const tailwindLogicalDirection = classNameRule(
  physicalUtility,
  'Use the logical direction utility instead (ps-/pe-, ms-/me-, start-/end-, ' +
    'text-start/text-end, rounded-s*/rounded-e*, border-s/border-e, float-start/float-end). ' +
    'Physical ones do not mirror for right-to-left languages.'
);

const tailwindAlphaTokenOpacity = classNameRule(
  alphaTokenWithModifier,
  'border, border-high, input, surface and accent already have their own transparency; ' +
    'an opacity modifier (/NN) on them produces invalid CSS and the color is dropped. ' +
    'Use the token without a modifier.'
);

const noQueryPluginTableCast = {
  meta: {
    type: 'problem',
    messages: {
      cast: 'Do not cast a query-plugin table to Table. Use ITableReadModel; mutating the live aggregate is forbidden (T7092).',
      castViaUnknown:
        'Do not cast a query-plugin table to Table via unknown/any. Use ITableReadModel (T7092).',
    },
    schema: [],
  },
  /** @param {any} context */
  create(context) {
    return {
      /** @param {any} node */
      TSAsExpression(node) {
        if (node.typeAnnotation.typeName?.name !== 'Table') return;
        const { expression } = node;
        if (expression.property?.name === 'table') {
          context.report({ node, messageId: 'cast' });
        } else if (
          expression.type === 'TSAsExpression' &&
          expression.expression.property?.name === 'table'
        ) {
          context.report({ node, messageId: 'castViaUnknown' });
        }
      },
    };
  },
};

/**
 * SSRF guardrail for *server* packages: steers raw outbound HTTP clients toward
 * the ssrf-http wrappers. Do NOT apply to frontend/browser packages — a
 * same-origin `fetch()` there is not SSRF. Matches only bare global `fetch()`,
 * not `obj.fetch()` or `safeFetch()`.
 */
const noBareFetch = {
  meta: {
    type: 'problem',
    messages: {
      bare: 'Bare fetch() is SSRF-risky. Use safeFetch() (backend) or an injected SSRF-guarded fetch (v2 packages, see createSsrfSafeFetch).',
    },
    schema: [],
  },
  /** @param {any} context */
  create(context) {
    return {
      /** @param {any} node */
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'fetch') {
          context.report({ node, messageId: 'bare' });
        }
      },
    };
  },
};

const { consistentTypeImports, namingConvention } = require('./typescript-eslint');

module.exports = {
  meta: { name: 'teable' },
  rules: {
    'consistent-type-imports': consistentTypeImports,
    'naming-convention': namingConvention,
    'no-bare-fetch': noBareFetch,
    'no-query-plugin-table-cast': noQueryPluginTableCast,
    'tailwind-alpha-token-opacity': tailwindAlphaTokenOpacity,
    'tailwind-logical-direction': tailwindLogicalDirection,
  },
};
