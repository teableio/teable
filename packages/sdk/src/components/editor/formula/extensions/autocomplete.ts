import { closeBrackets } from '@codemirror/autocomplete';
import { bracketMatching } from '@codemirror/language';

export const BRACKET_MATCHING_EXTENSION = bracketMatching();
export const CLOSE_BRACKETS_EXTENSION = closeBrackets();
export const AUTOCOMPLETE_EXTENSIONS = [BRACKET_MATCHING_EXTENSION, CLOSE_BRACKETS_EXTENSION];
