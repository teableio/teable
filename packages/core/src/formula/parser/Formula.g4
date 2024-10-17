/*
 * Portions of this file are based on Baserow software.
 * 
 * Copyright (c) 2019-present Baserow B.V.
 *
 * The MIT License
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

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
    | MINUS expr # UnaryOp
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
