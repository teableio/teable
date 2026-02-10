/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ANTLRErrorListener, RecognitionException, Recognizer, Token } from 'antlr4ts';

export class FormulaErrorListener implements ANTLRErrorListener<Token> {
  syntaxError<T extends Token>(
    _recognizer: Recognizer<T, any>,
    _offendingSymbol: T | undefined,
    line: number,
    charPositionInLine: number,
    msg: string,
    _e: RecognitionException | undefined
  ): void {
    throw new Error(msg.split('expecting')[0].trim());
  }
}
