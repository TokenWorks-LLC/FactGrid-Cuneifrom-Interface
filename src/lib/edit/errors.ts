export type TranscriptEditErrorCode =
  | "invalid_request"
  | "rate_limited"
  | "identity_mismatch"
  | "editor_not_authorized"
  | "account_blocked"
  | "missing_edit_right"
  | "page_not_editable"
  | "target_not_allowed"
  | "unsupported_edition"
  | "edit_conflict"
  | "provider_rejected_edit"
  | "factgrid_unavailable"
  | "save_status_unknown"
  | "save_confirmation_failed";

export class TranscriptEditError extends Error {
  readonly code: TranscriptEditErrorCode;
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(
    code: TranscriptEditErrorCode,
    message: string,
    options: { status: number; retryAfterSeconds?: number; cause?: unknown },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "TranscriptEditError";
    this.code = code;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function isTranscriptEditError(error: unknown): error is TranscriptEditError {
  return error instanceof TranscriptEditError;
}
