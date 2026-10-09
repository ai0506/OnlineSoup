export type PlayerError = { code: string; message: string; retryable: boolean; retry_after_seconds?: number };
export type PlayerEnvelope<T = unknown> = { api_version: 1; ok: boolean; data: T | null; error: PlayerError | null };
export function success<T>(data: T): PlayerEnvelope<T> { return { api_version: 1, ok: true, data, error: null }; }
export function failure(code: string, message: string, retryable = false, retry_after_seconds?: number): PlayerEnvelope<never> {
  return { api_version: 1, ok: false, data: null, error: { code, message, retryable, ...(retry_after_seconds ? { retry_after_seconds } : {}) } };
}
export function exitCode(code?: string): number {
  if (!code) return 0;
  if (['REQUEST_RESULT_UNKNOWN', 'REQUEST_PENDING', 'NETWORK_ERROR'].includes(code)) return 5;
  if (['LOGIN_REQUIRED','CLI_SESSION_REQUIRED','AUTH_EXPIRED','USERNAME_REQUIRED','OWNER_NOT_SUPPORTED','USE_PLAYER_API'].includes(code)) return 3;
  if (['INVALID_INPUT','INVALID_COMMAND','REQUIRED_INPUT_MISSING','CLIENT_TOO_OLD'].includes(code)) return 2;
  if (['SERVER_ERROR','REQUEST_RECORD_UNAVAILABLE'].includes(code)) return 6;
  return 4;
}
