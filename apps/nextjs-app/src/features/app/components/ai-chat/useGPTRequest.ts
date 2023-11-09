import { encode } from '@nem035/gpt-3-encoder';
import { createParser } from 'eventsource-parser';
import { useState } from 'react';
import type { CreatorRole } from 'store/message';

export const countTextTokens = (text: string) => {
  return encode(text).length;
};

export const useGPTRequest = () => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  // eslint-disable-next-line sonarjs/cognitive-complexity
  const fetchChatGPTResponse = async (
    messages: { role: CreatorRole; content: string }[],
    update: (text: string, done?: boolean, err?: boolean) => void
    // eslint-disable-next-line sonarjs/cognitive-complexity
  ) => {
    setIsLoading(true);

    const requestBody = {
      model: 'gpt-3.5-turbo',
      messages,
      temperature: 0,
      frequency_penalty: 0.0,
      presence_penalty: 0.0,
      stream: true,
    };

    console.log('sendMessage:', messages);
    try {
      const response = await fetch('/api/chart/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(response.statusText);
      }

      let counter = 0;
      let responseText = '';

      const parser = createParser((event) => {
        if (event.type === 'event') {
          const data = event.data;
          // https://beta.openai.com/docs/api-reference/completions/create#completions/create-stream
          if (data === '[DONE]') {
            update(responseText, true);
            return;
          }
          const json = JSON.parse(data);
          const text = json.choices[0].delta?.content || '';
          if (counter < 2 && (text.match(/\n/) || []).length) {
            // this is a prefix character (i.e., "\n\n"), do nothing
            return;
          }

          responseText += text;
          update(responseText);
          counter++;
        }
      });

      const reader = response.body?.getReader();

      if (reader) {
        const decoder = new TextDecoder('utf-8');

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

          parser.feed(decoder.decode(value));
        }
      }

      setIsLoading(false);
    } catch (error) {
      console.error('Error fetching data:', error);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update('Error fetching data:' + (error as any).message, false, true);
      setIsLoading(false);
    }
  };

  return { isLoading, fetchChatGPTResponse };
};
