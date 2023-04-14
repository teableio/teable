import router from 'next/router';
import type { IUser } from 'store/user';
import type { IPromptContext } from '../type';
import { AI_SYNTAX_PROMPT } from './aiSyntaxPrompt';
import { tableContext2Prompt } from './tableContext2Prompt';

// getPromptOfAssistant define the special prompt for each assistant.
export function getPromptGeneratorOfAssistant(
  assistant: IUser
): (prompt: string, promptContext?: IPromptContext) => Promise<string> | string {
  const basicPrompt = `Your name is Tai, and you are an AI assistant for Teable.
Use the same natural language to respond as the one used for asking the question.
${AI_SYNTAX_PROMPT}
\n`;
  if (assistant.id === 'tai-app') {
    return async (prompt: string, promptContext?: IPromptContext) => {
      const { nodeId, viewId } = router.query as { nodeId: string; viewId: string };
      const tableContextPrompt = await tableContext2Prompt(nodeId, viewId);
      if (!promptContext) {
        return '';
      }
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { GENERATE_CHART_PROMPT, CREATE_TABLE_PROMPT } = promptContext;
      if (prompt.match(/chart|图/gi)) {
        return `${basicPrompt}, This is create chart method syntax define: "${GENERATE_CHART_PROMPT}".
Here is my table structure data: ${tableContextPrompt}\n 
Please use markdown code block to output syntax, please use "\`\`\`ai" to create the code block.
`;
      }
      return `${basicPrompt}, Here is my table structure data: ${tableContextPrompt}
This is create table method syntax define: "${CREATE_TABLE_PROMPT}".
Please use markdown code block to output syntax, please use "\`\`\`ai" to create the code block.
If the question mentions tables, systems, or databases, you can assume that it is referring to creating a table. 
      \n`;
    };
  }
  return () => `\n${basicPrompt}`;
}
