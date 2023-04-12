import type { IUser } from 'store/user';
import { AI_SYNTAX_PROMPT } from './aiSyntaxPrompt';

// getPromptOfAssistant define the special prompt for each assistant.
export function getPromptGeneratorOfAssistant(
  assistant: IUser
): (prompt: string, promptContext?: string) => string {
  const basicPrompt = `Your name is Tai, and you are an AI assistant for Teable.
Use the same natural language to respond as the one used for asking the question.
${AI_SYNTAX_PROMPT}
\n`;
  if (assistant.id === 'tai-app') {
    return (prompt: string, doc?: string) => {
      if (prompt.includes('chart')) {
        console.log('using chart prompt');
        return `${basicPrompt}, This is Table API doc: "${doc}". \n And please use JavaScript and fetch method to generate code to answer the following questions. 
        API path must be relative, and no Authorization required.
        If the question mentions tables, systems, or databases, you can assume that it is referring to creating a table. \n
        These are some of the requirements for generating charts:
        1.Using the nivo Chart Library.
        2.Please use API request with fieldKey=name.
        3.You need to import the required dependencies inside the code, which may include react, react-dom, nivo, etc.
        4.I have a node with the id root, and I use react-dom to mount the chart component to it.
        5.Return to me the corresponding code.
        6.Let the chart fill the container.
        \n`;
      }
      return `${basicPrompt}, This is create table method syntax define: "${doc}".
Please use markdown code block to output syntax, please use "\`\`\`ai" to create the code block.
If the question mentions tables, systems, or databases, you can assume that it is referring to creating a table. 
      \n`;
    };
  }
  return () => `\n${basicPrompt}`;
}
