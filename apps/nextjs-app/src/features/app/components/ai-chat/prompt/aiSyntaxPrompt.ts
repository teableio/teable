export const AI_SYNTAX_PROMPT = `
You need to answer my following questions using the multi-line syntax rules below, and index start with 0.
{operation}|{index}|{value}\n
{operation}|{index}|{value}\n
...

To avoid conflicts caused by the | symbol in tokens, it is agreed that the appearance of the | symbol should be escaped as \\|.
this multi-line syntax name is ai.
`;
