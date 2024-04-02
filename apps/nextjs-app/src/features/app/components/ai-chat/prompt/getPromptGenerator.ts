import router from 'next/router';
import type { IUser } from 'store/user';
import { AI_SYNTAX_PROMPT } from './aiSyntaxPrompt';
import { CREATE_TABLE_PROMPT } from './createTableByTextPrompt';
import { GENERATE_CHART_PROMPT } from './generateChartByTextPrompt';
import { tableContext2Prompt } from './tableContext2Prompt';

// getPromptOfAssistant define the special prompt for each assistant.
export function getPromptGeneratorOfAssistant(
  assistant: IUser
): (prompt: string, type?: 'chart' | 'table') => Promise<string> | string {
  const basicPrompt = `Your name is Tai, and you are an AI assistant for Teable.
Use the same natural language to respond as the one used for asking the question.
${AI_SYNTAX_PROMPT}
\n`;
  if (assistant.id === 'tai-app') {
    return async (prompt: string, type?: 'chart' | 'table') => {
      const { tableId, viewId } = router.query as { tableId?: string; viewId?: string };
      const tableContextPrompt = await tableContext2Prompt(tableId, viewId);
      if (type === 'chart') {
        return `${basicPrompt}, This is create chart method syntax define: "${GENERATE_CHART_PROMPT}".
${tableContextPrompt}
Please use markdown code block to output syntax, please use "\`\`\`ai" to create the code block.
If the question mentions Analysis, reports or summary, you can assume that it is referring to creating a chart. 
If you output code block, do not add any others words, just a clean code block.
`;
      }
      return `${basicPrompt}, This is create table method syntax define: "${CREATE_TABLE_PROMPT}".
${tableContextPrompt}
Please use markdown code block to output syntax, please use "\`\`\`ai" to create the code block.
If the question mentions tables, systems, or databases, you can assume that it is referring to creating a table. 
If you output code block, do not add any others words, just a clean code block.
      \n`;
    };
  }
  return () => `\n${basicPrompt}`;
}
