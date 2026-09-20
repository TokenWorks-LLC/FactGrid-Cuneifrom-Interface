export type FactGridErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "NOT_IN_CATALOGUE"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_UNAVAILABLE"
  | "UPSTREAM_PROTOCOL"
  | "UPSTREAM_RESPONSE_TOO_LARGE"
  | "UNSUPPORTED_DOCUMENT"
  | "TRANSCRIPT_CONFLICT";

export class FactGridError extends Error {
  readonly code: FactGridErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(
    code: FactGridErrorCode,
    message: string,
    options: { status?: number; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "FactGridError";
    this.code = code;
    this.status = options.status ?? 500;
    this.retryable = options.retryable ?? false;
  }
}

export class FactGridInputError extends FactGridError {
  constructor(message: string) {
    super("INVALID_INPUT", message, { status: 400 });
    this.name = "FactGridInputError";
  }
}

export class FactGridNotFoundError extends FactGridError {
  constructor(qid: string, outsideCatalogue = false) {
    super(
      outsideCatalogue ? "NOT_IN_CATALOGUE" : "NOT_FOUND",
      outsideCatalogue
        ? `${qid} is not a member of the FactGrid cuneiform catalogue.`
        : `No FactGrid item was found for ${qid}.`,
      { status: 404 },
    );
    this.name = "FactGridNotFoundError";
  }
}

export function isFactGridError(error: unknown): error is FactGridError {
  return error instanceof FactGridError;
}
