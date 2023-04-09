import type { IUser } from 'store/user';

// getPromptOfAssistant define the special prompt for each assistant.
export function getPromptGeneratorOfAssistant(
  assistant: IUser
): (promptContext?: string) => string {
  const basicPrompt = `Your name is Tai, and you are an AI assistant for Teable, Please be careful to return only key information, and try not to make it too long.
Set the programming language to the markdown code block for each code block. For example, \`let a = 1\` is JavaScript.
Use the same natural language to respond as the one used for asking the question.
\n`;
  if (assistant.id === 'tai-app') {
    return (doc?: string) =>
      `${basicPrompt}, This is Table API doc: "${doc}". \n And please use JavaScript and fetch method to generate code to answer the following questions. 
API path must be relative, and no Authorization required.
If the question mentions tables, systems, or databases, you can assume that it is referring to creating a table. 
\n`;
  }
  return () => `\n${basicPrompt}`;
}
