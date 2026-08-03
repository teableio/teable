parser grammar Query;

options { tokenVocab=QueryLexer; }

start :
    expr EOF
    ;

expr
    : queryStatement                                                    #queryExpr
    | expr op = (AND_SYMBOL | OR_SYMBOL) expr                           #binaryExpr
    | OPEN_PAREN expr CLOSE_PAREN                                       #parenQueryExpr
    ;

queryStatement:
    predicate                                                           #primaryExprPredicate
    | fieldIdentifier isOp                                              #primaryExprIs
    | fieldIdentifier compOp value                                      #primaryExprCompare
    ;

predicate:
    fieldIdentifier likeOp value                                        #predicateExprLike
    | fieldIdentifier inOp valueList                                    #predicateExprIn
    | fieldIdentifier HAS_SYMBOL valueList                              #predicateExprHas
    | fieldIdentifier EQUAL_OPERATOR valueList                          #predicateExprEqArray
    ;

fieldIdentifier:
    SIMPLE_IDENTIFIER
    ;

compOp:
    EQUAL_OPERATOR
    | NOT_EQUAL_OPERATOR
    | NOT_EQUAL2_OPERATOR
    | GT_OPERATOR
    | GTE_OPERATOR
    | LT_OPERATOR
    | LTE_OPERATOR
    ;

isOp:
    LS_NULL_SYMBOL
    | LS_NOT_NULL_SYMBOL
    ;

likeOp:
    LIKE_SYMBOL
    | NOT_LIKE_SYMBOL
    ;

inOp:
    IN_SYMBOL
    | NOT_IN_SYMBOL
    ;

value:
    literal
    ;
valueList:
    OPEN_PAREN (literal (COMMA literal)*)? CLOSE_PAREN
    ;

literal:
    stringLiteral
    | numberLiteral
    | booleanLiteral
    | nullLiteral
    ;

stringLiteral:
    SINGLEQ_STRING_LITERAL
    | DOUBLEQ_STRING_LITERAL
    ;

numberLiteral:
    INTEGER_LITERAL
    | NUMERIC_LITERAL
    ;

booleanLiteral:
    TRUE_SYMBOL
    | FALSE_SYMBOL
    ;

nullLiteral:
    NULL_SYMBOL
    ;
