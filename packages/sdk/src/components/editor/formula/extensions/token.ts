/* eslint-disable @typescript-eslint/naming-convention */
import type { StringStream, TagStyle } from '@codemirror/language';
import { HighlightStyle, syntaxHighlighting, StreamLanguage } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { FormulaLexer } from '@teable/core';
import colors from 'tailwindcss/colors';

enum TokenGroup {
  Variable = 'variable',
  Paren = 'paren',
  Number = 'number',
  String = 'string',
  Operator = 'operator',
  Keyword = 'keyword',
  Comment = 'comment',
}

const FORMULA_GRAMMARS = [
  {
    group: TokenGroup.Variable,
    type: FormulaLexer.IDENTIFIER_VARIABLE,
    reg: /(\{\})|(\{(\\[{}])*[\s\S]*?[^\\]\})/,
  },
  {
    group: TokenGroup.String,
    type: FormulaLexer.DOUBLEQ_STRING_LITERAL,
    reg: /(["”“](([^\\"“”])*\\["”“])*.*?["”“])/,
  },
  {
    group: TokenGroup.String,
    type: FormulaLexer.SINGLEQ_STRING_LITERAL,
    reg: /(['‘’](([^\\'‘’])*\\['‘’])*.*?['‘’])/,
  },
  {
    group: TokenGroup.Keyword,
    type: FormulaLexer.IDENTIFIER_UNICODE,
    reg: /[^\d.+\-|=*/><()（）!&%'"“”‘’^`~,，\s][^+\-|=*/><()（）!&%'"“”‘’^`~,，\s]*/,
  },
  { group: TokenGroup.Comment, type: FormulaLexer.R_CURLY, reg: /\/\/.*/ },
  { group: TokenGroup.Number, type: FormulaLexer.NUMERIC_LITERAL, reg: /[\d.]+/ },
  { group: TokenGroup.Operator, type: FormulaLexer.EQUAL, reg: /=/ },
  { group: TokenGroup.Operator, type: FormulaLexer.BANG_EQUAL, reg: /!=/ },
  { group: TokenGroup.Operator, type: FormulaLexer.GTE, reg: />=/ },
  { group: TokenGroup.Operator, type: FormulaLexer.GT, reg: />/ },
  { group: TokenGroup.Operator, type: FormulaLexer.LTE, reg: /<=/ },
  { group: TokenGroup.Operator, type: FormulaLexer.LT, reg: /</ },
  { group: TokenGroup.Operator, type: FormulaLexer.AMP_AMP, reg: /&&/ },
  { group: TokenGroup.Operator, type: FormulaLexer.AMP, reg: /&/ },
  { group: TokenGroup.Operator, type: FormulaLexer.PIPE_PIPE, reg: /\|\|/ },
  { group: TokenGroup.Operator, type: FormulaLexer.PIPE, reg: /\|/ },
  { group: TokenGroup.Operator, type: FormulaLexer.COMMA, reg: /[,，]/ },
  { group: TokenGroup.Operator, type: FormulaLexer.BANG, reg: /!/ },
  { group: TokenGroup.Operator, type: FormulaLexer.PLUS, reg: /\+/ },
  { group: TokenGroup.Operator, type: FormulaLexer.MINUS, reg: /-/ },
  { group: TokenGroup.Operator, type: FormulaLexer.STAR, reg: /\*/ },
  { group: TokenGroup.Operator, type: FormulaLexer.SLASH, reg: /\// },
  { group: TokenGroup.Operator, type: FormulaLexer.PERCENT, reg: /%/ },
  { group: TokenGroup.Paren, type: FormulaLexer.L_CURLY, reg: /[(（]/ },
  { group: TokenGroup.Paren, type: FormulaLexer.R_CURLY, reg: /[)）]/ },
];

export const TOKEN_THEME = [
  { tag: t.keyword, color: colors.sky[600] },
  { tag: t.variableName, color: colors.sky[600] },
  { tag: t.string, color: colors.yellow[600] },
  { tag: t.number, color: colors.green[600] },
  { tag: t.operator, color: colors.orange[600] },
  { tag: t.paren, color: colors.sky[600] },
];

const token = StreamLanguage.define({
  token: (stream: StringStream) => {
    for (const token of FORMULA_GRAMMARS) {
      if (stream.match(token.reg)) {
        return token.group;
      }
    }

    stream.next();
    return 'error';
  },
});

const tokenHighlight = syntaxHighlighting(HighlightStyle.define(TOKEN_THEME as TagStyle[]));

export const TOKEN_EXTENSIONS = [token, tokenHighlight];
