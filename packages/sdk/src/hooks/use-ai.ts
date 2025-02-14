import { aiGenerateStream } from '@teable/openapi';
import { useCallback, useState, useRef } from 'react';
import { useBaseId } from './use-base-id';

interface IUseAIStreamOptions {
  timeout?: number; // unit: ms
}

export const useAIStream = (options?: IUseAIStreamOptions) => {
  const { timeout = 30000 } = options || {};
  const baseId = useBaseId();
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const generateAIResponse = useCallback(
    async (prompt: string) => {
      setText('');
      setError(null);
      setLoading(true);

      controllerRef.current = new AbortController();
      const timeoutId = setTimeout(() => controllerRef.current?.abort(), timeout);

      try {
        const result = await aiGenerateStream(baseId!, { prompt }, controllerRef.current.signal);

        if (!result.ok) {
          throw new Error(`HTTP error! status: ${result.status}`);
        }

        const reader = result.body?.getReader();

        if (!reader) throw new Error('No reader available');

        let reading = true;
        while (reading) {
          const { done, value } = await reader.read();
          if (done) {
            reading = false;
            break;
          }

          const chunk = new TextDecoder().decode(value);
          setText((prev) => prev + chunk);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        setError(errorMessage);
        console.error('Error streaming AI response:', error);
      } finally {
        clearTimeout(timeoutId);
        setLoading(false);
      }
    },
    [baseId, timeout]
  );

  const stop = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  return { text, generateAIResponse, loading, error, stop };
};
