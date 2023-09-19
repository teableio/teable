parser grammar Formula;

options { tokenVocab=FormulaLexer; }

root
    : expr EOF
    ;
expr
    :
    SINGLEQ_STRING_LITERAL # StringLiteral
    | DOUBLEQ_STRING_LITERAL #  StringLiteral
    | INTEGER_LITERAL # IntegerLiteral
    | NUMERIC_LITERAL # DecimalLiteral
    | (TRUE | FALSE) # BooleanLiteral
    | ws_or_comment expr # LeftWhitespaceOrComments
    | expr ws_or_comment # RightWhitespaceOrComments
    | OPEN_PAREN expr CLOSE_PAREN # Brackets
    | expr op=(SLASH | STAR | PERCENT) expr # BinaryOp
    | expr op=(PLUS | MINUS) expr # BinaryOp
    | expr op=(GT | LT | GTE | LTE) expr # BinaryOp
    | expr op=(EQUAL | BANG_EQUAL) expr # BinaryOp
    | expr op=AMP_AMP expr # BinaryOp
    | expr op=PIPE_PIPE expr # BinaryOp
    | expr op=AMP expr # BinaryOp
    | field_reference_curly # FieldReferenceCurly
    // | LOOKUP OPEN_PAREN field_reference COMMA WHITESPACE? field_reference CLOSE_PAREN # LookupFieldReference
    | func_name OPEN_PAREN (expr (COMMA expr)*)? CLOSE_PAREN # FunctionCall
    ;

ws_or_comment
    : BLOCK_COMMENT
    | LINE_COMMENT
    | WHITESPACE
    ;

field_reference
    : IDENTIFIER_UNICODE
    ;

field_reference_curly
    : IDENTIFIER_VARIABLE
    ;

func_name
    : identifier
    ;

identifier
    : IDENTIFIER
    | IDENTIFIER_UNICODE
    ;
