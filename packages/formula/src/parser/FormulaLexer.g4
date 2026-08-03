// The MIT License

// Copyright 2018 Tal Shprecher

// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

lexer grammar FormulaLexer;


// Fragments
fragment A          : ('A'|'a') ;
fragment B          : ('B'|'b') ;
fragment C          : ('C'|'c') ;
fragment D          : ('D'|'d') ;
fragment E          : ('E'|'e') ;
fragment F          : ('F'|'f') ;
fragment G          : ('G'|'g') ;
fragment H          : ('H'|'h') ;
fragment I          : ('I'|'i') ;
fragment J          : ('J'|'j') ;
fragment K          : ('K'|'k') ;
fragment L          : ('L'|'l') ;
fragment M          : ('M'|'m') ;
fragment N          : ('N'|'n') ;
fragment O          : ('O'|'o') ;
fragment P          : ('P'|'p') ;
fragment Q          : ('Q'|'q') ;
fragment R          : ('R'|'r') ;
fragment S          : ('S'|'s') ;
fragment T          : ('T'|'t') ;
fragment U          : ('U'|'u') ;
fragment V          : ('V'|'v') ;
fragment W          : ('W'|'w') ;
fragment X          : ('X'|'x') ;
fragment Y          : ('Y'|'y') ;
fragment Z          : ('Z'|'z') ;
fragment UNDERSCORE : '_' ;

fragment HEX_DIGIT                    : [0-9A-F];
fragment DEC_DIGIT                    : [0-9];
fragment DQUOTA_STRING                : '"' ( '\\'. | ~('"' | '\\') )* '"';
fragment SQUOTA_STRING                : '\'' ('\\'. | ~('\'' | '\\'))* '\'';
fragment BQUOTA_STRING                : '`' ( '\\'. | '``' | ~('`' | '\\'))* '`';

// Skip whitespace and comments
BLOCK_COMMENT       : '/*' .* '*/';
LINE_COMMENT        : '//' ~[\r\n]*;
WHITESPACE          : [ \t\r\n]+;

TRUE                                 : T R U E;
FALSE                                : F A L S E;

FIELD                                : F I E L D;

// LOOKUP                               : L O O K U P;

// language tokens
COMMA                                : ',';
COLON                                : ':';
COLON_COLON                          : '::';
DOLLAR                               : '$';
DOLLAR_DOLLAR                        : '$$';
STAR                                 : '*';
OPEN_PAREN                           : '(';
CLOSE_PAREN                          : ')';
OPEN_BRACKET                         : '[';
CLOSE_BRACKET                        : ']';
L_CURLY                              : '{';
R_CURLY                              : '}';
BIT_STRING                           : B '\'' ('0'|'1')* '\'';
REGEX_STRING                         : E SQUOTA_STRING;
NUMERIC_LITERAL                      : DEC_DIGIT+ '.' DEC_DIGIT+ (E ('-')* DEC_DIGIT+)?;
INTEGER_LITERAL                      : DEC_DIGIT+ (E DEC_DIGIT+)?;
HEX_INTEGER_LITERAL                  : 'x' SQUOTA_STRING;
DOT                                  : '.';
SINGLEQ_STRING_LITERAL               : SQUOTA_STRING;
DOUBLEQ_STRING_LITERAL               : DQUOTA_STRING;
IDENTIFIER_VARIABLE                  : '{' .*? '}';
IDENTIFIER_UNICODE                   : [a-zA-Z_\u00A1-\uFFFF][a-zA-Z_\u00A1-\uFFFF0-9]*;
IDENTIFIER                           : [a-zA-Z_][a-zA-Z_0-9]*;

// operator tokens
AMP                                  : '&';
AMP_AMP                              : '&&';
AMP_LT                               : '&<';
AT_AT                                : '@@';
AT_GT                                : '@>';
AT_SIGN                              : '@';
BANG                                 : '!';
BANG_BANG                            : '!!';
BANG_EQUAL                           : '!=';
CARET                                : '^';
EQUAL                                : '=';
EQUAL_GT                             : '=>';
GT                                   : '>';
GTE                                  : '>=';
GT_GT                                : '>>';
HASH                                 : '#';
HASH_EQ                              : '#=';
HASH_GT                              : '#>';
HASH_GT_GT                           : '#>>';
HASH_HASH                            : '##';
HYPHEN_GT                            : '->';
HYPHEN_GT_GT                         : '->>';
HYPHEN_PIPE_HYPHEN                   : '-|-';
LT                                   : '<';
LTE                                  : '<=';
LT_AT                                : '<@';
LT_CARET                             : '<^';
LT_GT                                : '<>';
LT_HYPHEN_GT                         : '<->';
LT_LT                                : '<<';
LT_LT_EQ                             : '<<=';
LT_QMARK_GT                          : '<?>';
MINUS                                : '-';
PERCENT                              : '%';
PIPE                                 : '|';
PIPE_PIPE                            : '||';
PIPE_PIPE_SLASH                      : '||/';
PIPE_SLASH                           : '|/';
PLUS                                 : '+';
QMARK                                : '?';
QMARK_AMP                            : '?&';
QMARK_HASH                           : '?#';
QMARK_HYPHEN                         : '?-';
QMARK_PIPE                           : '?|';
SLASH                                : '/';
TIL                                  : '~';
TIL_EQ                               : '~=';
TIL_GTE_TIL                          : '~>=~';
TIL_GT_TIL                           : '~>~';
TIL_LTE_TIL                          : '~<=~';
TIL_LT_TIL                           : '~<~';
TIL_STAR                             : '~*';
TIL_TIL                              : '~~';
SEMI:                ';';

// Any character which does not match one of the above rules will appear in the token
// stream as an ErrorCharacter token. This ensures the lexer itself will never encounter
// a syntax error, so all error handling may be performed by the parser.
ErrorCharacter
    :   .
    ;
