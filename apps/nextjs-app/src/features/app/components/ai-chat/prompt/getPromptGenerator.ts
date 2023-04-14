import { Table } from '@teable-group/sdk/model';
import router from 'next/router';
import type { IUser } from 'store/user';
import type { IPromptContext } from '../type';
import { AI_SYNTAX_PROMPT } from './aiSyntaxPrompt';

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
      if (!promptContext) {
        return '';
      }
      if (prompt.includes('chart')) {
        const { nodeId, viewId } = router.query;
        const _fields = await Table.getFields(nodeId as string, viewId as string);
        const field = _fields.map((field) => field.name);
        return `${basicPrompt}, This is create table method syntax define: "${
          promptContext.GENERATE_CHART_PROMPT
        }".
        Here is my table header data: "| ${field.join(' | ')} |". \n 
        Please use markdown code block to output syntax, please use "\`\`\`ai" to create the code block.\n`;
      }
      return `${basicPrompt}, This is create table method syntax define: "${promptContext.CREATE_TABLE_PROMPT}".
Please use markdown code block to output syntax, please use "\`\`\`ai" to create the code block.
If the question mentions tables, systems, or databases, you can assume that it is referring to creating a table. 
      \n`;
    };
  }
  return () => `\n${basicPrompt}`;
}
