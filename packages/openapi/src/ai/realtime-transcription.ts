import { z } from '../zod';

export const DEFAULT_REALTIME_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';
export const DEFAULT_REALTIME_TRANSCRIPTION_MAX_SESSION_DURATION_SEC = 120;
export const DEFAULT_REALTIME_TRANSCRIPTION_SESSION_CREATE_LIMIT_PER_MINUTE = 6;
export const DEFAULT_OPENAI_TRANSCRIPTION_API_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_OPENAI_REALTIME_API_BASE_URL = DEFAULT_OPENAI_TRANSCRIPTION_API_BASE_URL;

export const realtimeTranscriptionModelSchema = z.enum([
  DEFAULT_REALTIME_TRANSCRIPTION_MODEL,
  'gpt-4o-transcribe',
  'whisper-1',
  'gpt-realtime-whisper',
]);

export const resolveOpenAIRealtimeEndpoints = (endpoint?: string | null) => {
  const value = (endpoint || DEFAULT_OPENAI_REALTIME_API_BASE_URL).trim().replace(/\/+$/, '');

  if (value.endsWith('/realtime/calls')) {
    return {
      clientSecretsUrl: value.replace(/\/calls$/, '/client_secrets'),
      callsUrl: value,
    };
  }

  if (value.endsWith('/realtime/client_secrets')) {
    return {
      clientSecretsUrl: value,
      callsUrl: value.replace(/\/client_secrets$/, '/calls'),
    };
  }

  if (value.endsWith('/realtime')) {
    return {
      clientSecretsUrl: `${value}/client_secrets`,
      callsUrl: `${value}/calls`,
    };
  }

  return {
    clientSecretsUrl: `${value}/realtime/client_secrets`,
    callsUrl: `${value}/realtime/calls`,
  };
};

export const resolveOpenAITranscriptionEndpoint = (endpoint?: string | null) => {
  let value = (endpoint || DEFAULT_OPENAI_TRANSCRIPTION_API_BASE_URL).trim().replace(/\/+$/, '');

  if (value.endsWith('/realtime/calls')) {
    value = value.replace(/\/realtime\/calls$/, '');
  } else if (value.endsWith('/realtime/client_secrets')) {
    value = value.replace(/\/realtime\/client_secrets$/, '');
  } else if (value.endsWith('/realtime')) {
    value = value.replace(/\/realtime$/, '');
  }

  if (value.endsWith('/audio/transcriptions')) {
    return value;
  }

  if (value.endsWith('/audio')) {
    return `${value}/transcriptions`;
  }

  return `${value}/audio/transcriptions`;
};
