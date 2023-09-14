import { closeBrackets } from '@codemirror/autocomplete';
import { bracketMatching } from '@codemirror/language';

export const AUTOCOMPLETE_EXTENSIONS = [bracketMatching(), closeBrackets()];
