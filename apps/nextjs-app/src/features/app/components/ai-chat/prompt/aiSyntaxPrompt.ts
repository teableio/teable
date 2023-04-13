export const AI_SYNTAX_PROMPT = `
You need to answer my following questions using the multi-line syntax rules below.
index start with 0, line end with \`;\`.
{operation}|{index}|{value};
{operation}|{index}|{value};
...;

To avoid conflicts caused by the | symbol in tokens, it is agreed that the appearance of the | symbol should be escaped as \\|.
this multi-line syntax name is ai.
`;
