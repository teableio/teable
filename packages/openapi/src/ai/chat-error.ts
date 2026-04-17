/* eslint-disable @typescript-eslint/naming-convention */

/**
 * Structured error codes for AI chat (Sandbox Agent path).
 * Shared between backend and frontend via @teable/openapi.
 */
export enum ChatErrorCode {
  // Sandbox lifecycle errors
  SANDBOX_BUSY = 'sandbox_busy',
  SANDBOX_CAPACITY_FULL = 'sandbox_capacity_full',
  SANDBOX_TRANSIENT = 'sandbox_transient',
  SANDBOX_SNAPSHOT_NOT_FOUND = 'sandbox_snapshot_not_found',

  // Model errors
  MODEL_NOT_SUPPORTED = 'model_not_supported',
  BYOK_MODEL_NOT_SUPPORTED = 'byok_model_not_supported',

  // Image/media errors
  IMAGE_PROCESSING_FAILED = 'image_processing_failed',

  // Billing errors
  CREDIT_LIMIT_EXCEEDED = 'credit_limit_exceeded',

  // Agent engine errors
  AGENT_START_FAILED = 'agent_start_failed',

  // API/infrastructure errors
  API_ERROR_5XX = 'api_error_5xx',
  RATE_LIMIT = 'rate_limit',
  AUTH_ERROR = 'auth_error',
  TIMEOUT = 'timeout',
  IDLE_TIMEOUT = 'idle_timeout',
  DISK_FULL = 'disk_full',
  NPM_INSTALL = 'npm_install',

  // Session recovery
  DANGLING_TOOL_USE = 'dangling_tool_use',

  // Generic
  UNKNOWN = 'unknown',
}

/**
 * Structured error payload sent from backend to frontend via SSE.
 * The errorText field in the SSE chunk contains JSON.stringify(IStructuredChatError).
 */
export interface IStructuredChatError {
  /** Application-specific error code */
  code: ChatErrorCode;
  /** User-friendly message */
  message: string;
  /** Technical details for debugging (shown in expandable section) */
  technical?: string;
  /** Additional data (e.g. { max: 5 } for capacity errors) */
  data?: Record<string, unknown>;
}
