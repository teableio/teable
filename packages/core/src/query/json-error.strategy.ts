import { DefaultErrorStrategy } from 'antlr4ts';
import type { Parser } from 'antlr4ts/Parser';
import type { RecognitionException } from 'antlr4ts/RecognitionException';

export class JsonErrorStrategy extends DefaultErrorStrategy {
  reportError(parser: Parser, _recognitionException: RecognitionException) {
    throw new Error(`expression parsing failure, invalid token: '${parser.currentToken.text}'`);
  }

  protected reportUnwantedToken(recognizer: Parser) {
    throw new Error(`unrecognized token: '${recognizer.currentToken.text}'`);
  }
}
