export type AppErrorCode =
  | "VALIDATION_ERROR"
  | "AUTHENTICATION_REQUIRED"
  | "INVALID_CREDENTIALS"
  | "FORBIDDEN"
  | "FEED_NOT_FOUND"
  | "FEED_ALREADY_EXISTS"
  | "FEED_FETCH_FAILED"
  | "FEED_PARSE_FAILED"
  | "DEMO_LIMIT_REACHED"
  | "ARTICLE_NOT_FOUND"
  | "RATE_LIMITED"
  | "APPEARANCE_NOT_FOUND"
  | "APPEARANCE_NAME_CONFLICT"
  | "APPEARANCE_VALIDATION_FAILED"
  | "APPEARANCE_LEASE_CONFLICT"
  | "APPEARANCE_LEASE_EXPIRED"
  | "APPEARANCE_LEASE_LOST"
  | "APPEARANCE_DRAFT_RESOLUTION_REQUIRED"
  | "APPEARANCE_IMPORT_UNSUPPORTED"
  | "APPEARANCE_BROWSER_VALIDATION_REQUIRED"
  | "APPEARANCE_RECONFIRM_REQUIRED"
  | "APPEARANCE_RESTORE_RECONFIRM_REQUIRED"
  | "APPEARANCE_BUSY"
  | "APPEARANCE_OPERATION_CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "INTERNAL_ERROR";

type AppErrorOptions = {
  code: AppErrorCode;
  message: string;
  status: number;
  details?: unknown;
  cause?: unknown;
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor({ code, message, status, details, cause }: AppErrorOptions) {
    super(message, { cause });
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
