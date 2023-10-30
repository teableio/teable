# Formula Language

This directory contains the [ANLTR Grammar](https://www.antlr.org/) for Teable formula

## Making changes to the language

If you want to make changes to the syntax of the formula language first you must update
the grammar .g4 files found in this directory. Once done you will then need to run `pnpm antlr4ts`
to re-build it.
