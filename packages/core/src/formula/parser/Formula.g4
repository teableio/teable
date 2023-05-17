parser grammar Formula;

options { tokenVocab=FormulaLexer; }

// ANTLR's starting point when parsing a given string. Can be read as
// "Parse a string that fits the 'expr' grammar definition followed by the end of the
// file"
root
    : expr EOF
    ;

// The core recursive grammar definition for the Baserow Formula language. Given a
// string ANTLR will work down through the rules separated by |s and seeing if the
// string matches any (matching the first one that fits).

// Notice that expr is defined by referencing itself letting users construct complex
// arbitrarily nested expressions.

// The CAPITAL_LETTER_VARIABLES are tokens defined in the FormulaLexer.g4 file.

// The '# StringLiteral' postfixes label separate rules into the same "labels".
// When the code gen then runs the resulting Visitor will have a visitLabel
// method which will be called for any nodes that result from any rule with that label.
// This lets us group multiple different rules into logical useful groups that we want
// to visit later on in the actual code.

// Also note that the order of the rules controls expression execution precedence.
// So because the SLASH binary op is in it's own rule it means a 1+1/2 will result in
// 1/2 being executed before 1+expr.
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
    | expr op=(SLASH | STAR) expr # BinaryOp
    | expr op=(PLUS | MINUS) expr # BinaryOp
    | expr op=(GT | LT | GTE | LTE) expr # BinaryOp
    | expr op=(EQUAL | BANG_EQUAL) expr # BinaryOp
    | FIELD OPEN_PAREN field_reference CLOSE_PAREN # FieldReference
    | LOOKUP OPEN_PAREN field_reference COMMA WHITESPACE? field_reference CLOSE_PAREN # LookupFieldReference
    | func_name OPEN_PAREN (expr (COMMA expr)*)? CLOSE_PAREN # FunctionCall
    ;

ws_or_comment
    : BLOCK_COMMENT
    | LINE_COMMENT
    | WHITESPACE
    ;

func_name
    : identifier
    ;

field_reference
    : SINGLEQ_STRING_LITERAL
    | DOUBLEQ_STRING_LITERAL
    ;

identifier
    : IDENTIFIER
    | IDENTIFIER_UNICODE
    ;

