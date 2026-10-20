/**
 * Opinionated config base for projects using react.
 * @see https://github.com/teableio/teable/tree/main/packages/eslint-config-bases
 */

const reactPatterns = {
  files: ['*.{jsx,tsx}'],
};

/**
 * Fine-tune naming convention react typescript jsx (function components)
 * @link https://github.com/typescript-eslint/typescript-eslint/blob/main/packages/eslint-plugin/docs/rules/naming-convention.md
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
 * one-line eslint-disable plus a reason.
 */
// esquery reads an attribute regex up to the first `/`, so the centering
// exemption is spelled "not followed by 1 or [" rather than by listing
// `left-1/2` and `left-[50%]`; arbitrary insets go unchecked as a result.
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

const message =
  'Use the logical direction utility instead (ps-/pe-, ms-/me-, start-/end-, ' +
  'text-start/text-end, rounded-s*/rounded-e*, border-s/border-e, float-start/float-end). ' +
  'Physical ones do not mirror for right-to-left languages.';

const logicalDirectionRules = [
  { selector: `Literal[value=${physicalUtility}]`, message },
  { selector: `TemplateElement[value.raw=${physicalUtility}]`, message },
];

/**
 * These color tokens already carry their own transparency (`--border: 0 0% 0% / 0.08`,
 * and `--accent` in dark mode). An opacity modifier stacks a second alpha, so
 * `border-border/40` compiles to `hsl(0 0% 0% / 0.08 / 0.4)`: invalid, and the
 * property falls back to its initial value (borders turn currentColor, backgrounds
 * transparent).
 */
// `\x2F` is the modifier's `/`, spelled so that esquery does not end the regex there.
const alphaTokenWithModifier = new RegExp(
  String.raw`(^|\s)!?(?:\S*:)?!?` +
    String.raw`(?:bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|divide|from|via|to|outline|stroke|fill|shadow|caret|accent|decoration|placeholder)` +
    String.raw`-(?:border|border-high|input|surface|accent)\x2F`
);

const alphaTokenMessage =
  'border, border-high, input, surface and accent already have their own transparency; ' +
  'an opacity modifier (/NN) on them produces invalid CSS and the color is dropped. ' +
  'Use the token without a modifier.';

const alphaTokenRules = [
  { selector: `Literal[value=${alphaTokenWithModifier}]`, message: alphaTokenMessage },
  {
    selector: `TemplateElement[value.raw=${alphaTokenWithModifier}]`,
    message: alphaTokenMessage,
  },
];

module.exports = {
  env: {
    browser: true,
    es6: true,
    node: true,
  },
  overrides: [
    {
      files: [...reactPatterns.files],
      extends: [
        // @see https://github.com/francoismassart/eslint-plugin-tailwindcss,
        'plugin:tailwindcss/recommended',
      ],
      rules: {
        'tailwindcss/no-custom-classname': 'off',
        'no-restricted-syntax': ['error', ...logicalDirectionRules, ...alphaTokenRules],
      },
    },
  ],
};
