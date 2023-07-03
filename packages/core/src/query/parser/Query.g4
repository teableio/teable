grammar Query;

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

FIELD                                : '{' ~('}')+ '}';

SINGLEQ_STRING_LITERAL               : SQUOTA_STRING;
DOUBLEQ_STRING_LITERAL               : DQUOTA_STRING;
INTEGER_LITERAL                      : '-'? DEC_DIGIT+ (('E'|'e') DEC_DIGIT+)?;
NUMERIC_LITERAL                      : '-'? DEC_DIGIT+ '.' DEC_DIGIT+ (('E'|'e') ('-')* DEC_DIGIT+)?;
TRUE                                 : T R U E;
FALSE                                : F A L S E;
NULL                                 : N U L L;

AND                                  : A N D;
OR                                   : O R;

EQUAL                                : '=';
NOT_EQUAL                            : '!=';
NOT_EQUAL2                           : '<>' -> type(NOT_EQUAL);
GT                                   : '>';
GTE                                  : '>=';
LT                                   : '<';
LTE                                  : '<=';
// BETWEEN                           : B E T W E E N;
LIKE                                 : L I K E;
IN                                   : I N;
NOT_LIKE                             : N O T SPACE L I K E;
NOT_IN                               : N O T SPACE I N;
IS_NULL                              : I S SPACE N U L L;
IS_NOT_NULL                          : I S SPACE N O T SPACE N U L L;


start : expression EOF ;

expression
    : OPEN_PAREN expression CLOSE_PAREN                  #parenExpression
    | expression binaryOperator expression               #binaryExpression
    | comparisonExpression                               #simpleComparison
    ;

comparisonExpression
    : field operator value?                              #fieldComparison
    ;

binaryOperator
    : AND
    | OR
    ;

field
    : FIELD
    ;
operator
    : EQUAL
    | NOT_EQUAL
    | NOT_EQUAL2
    | GT
    | GTE
    | LT
    | LTE
//    | BETWEEN
    | LIKE
    | IN
    | NOT_LIKE
    | NOT_IN
    | IS_NULL
    | IS_NOT_NULL
    ;
value
    : literal
    | OPEN_PAREN (literal (COMMA literal)*)? CLOSE_PAREN
    ;

literal
    : stringLiteral
    | numberLiteral
    | booleanLiteral
    | nullLiteral
    ;

stringLiteral
    : SINGLEQ_STRING_LITERAL
    | DOUBLEQ_STRING_LITERAL
    ;

numberLiteral
    : INTEGER_LITERAL
    | NUMERIC_LITERAL
    ;

booleanLiteral
    : TRUE
    | FALSE
    ;

nullLiteral
    : NULL
    ;

WS : [ \t\r\n]+ -> skip ;