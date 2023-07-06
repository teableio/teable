lexer grammar QueryLexer;

fragment A: [aA];
fragment B: [bB];
fragment C: [cC];
fragment D: [dD];
fragment E: [eE];
fragment F: [fF];
fragment G: [gG];
fragment H: [hH];
fragment I: [iI];
fragment J: [jJ];
fragment K: [kK];
fragment L: [lL];
fragment M: [mM];
fragment N: [nN];
fragment O: [oO];
fragment P: [pP];
fragment Q: [qQ];
fragment R: [rR];
fragment S: [sS];
fragment T: [tT];
fragment U: [uU];
fragment V: [vV];
fragment W: [wW];
fragment X: [xX];
fragment Y: [yY];
fragment Z: [zZ];

fragment DEC_DIGIT                    : [0-9];
fragment DQUOTA_STRING                : '"' ( '\\'. | ~('"' | '\\') )* '"';
fragment SQUOTA_STRING                : '\'' ('\\'. | ~('\'' | '\\'))* '\'';
fragment SPACE                        : [ \t];


COMMA                                : ',';
OPEN_PAREN                           : '(';
CLOSE_PAREN                          : ')';
OPEN_BRACKET                         : '[';
CLOSE_BRACKET                        : ']';
L_CURLY                              : '{';
R_CURLY                              : '}';

SIMPLE_IDENTIFIER                    : '{' ~('}')+ '}';

SINGLEQ_STRING_LITERAL               : SQUOTA_STRING;
DOUBLEQ_STRING_LITERAL               : DQUOTA_STRING;
INTEGER_LITERAL                      : '-'? DEC_DIGIT+ (('E'|'e') DEC_DIGIT+)?;
NUMERIC_LITERAL                      : '-'? DEC_DIGIT+ '.' DEC_DIGIT+ (('E'|'e') ('-')* DEC_DIGIT+)?;

EQUAL_OPERATOR                       : '=';
NOT_EQUAL_OPERATOR                   : '!=';
NOT_EQUAL2_OPERATOR                  : '<>' -> type(NOT_EQUAL_OPERATOR);
GT_OPERATOR                          : '>';
GTE_OPERATOR                         : '>=';
LT_OPERATOR                          : '<';
LTE_OPERATOR                         : '<=';

TRUE_SYMBOL                          : T R U E;
FALSE_SYMBOL                         : F A L S E;

AND_SYMBOL                           : A N D;
OR_SYMBOL                            : O R;

NOT_SYMBOL                           : N O T;
NULL_SYMBOL                          : N U L L;
IS_SYMBOL                            : I S;

LS_NULL_SYMBOL                       : I S SPACE N U L L;
LS_NOT_NULL_SYMBOL                   : I S SPACE N O T SPACE N U L L;
LIKE_SYMBOL                          : L I K E;
IN_SYMBOL                            : I N;
HAS_SYMBOL                           : H A S;
NOT_LIKE_SYMBOL                      : N O T SPACE L I K E;
NOT_IN_SYMBOL                        : N O T SPACE I N;


// White space handling
WHITESPACE: [ \t\r\n] -> channel(HIDDEN); // Ignore whitespaces.
