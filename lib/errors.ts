/**
 * Consistent application errors.
 * Services throw AppError; route handlers / server actions translate
 * them into a uniform shape via `toErrorResponse` / `getErrorMessage`.
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code = "INTERNAL_ERROR", status = 500) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }

  static badRequest(message: string): AppError {
    return new AppError(message, "BAD_REQUEST", 400);
  }

  static unauthorized(message = "Unauthorized"): AppError {
    return new AppError(message, "UNAUTHORIZED", 401);
  }

  static forbidden(message = "Forbidden"): AppError {
    return new AppError(message, "FORBIDDEN", 403);
  }

  static notFound(message = "Not found"): AppError {
    return new AppError(message, "NOT_FOUND", 404);
  }

  static notImplemented(feature: string): AppError {
    return new AppError(`${feature} is not implemented yet`, "NOT_IMPLEMENTED", 501);
  }
}

export interface ErrorResponseBody {
  error: { code: string; message: string };
}

export function toErrorResponse(error: unknown): { status: number; body: ErrorResponseBody } {
  if (error instanceof AppError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message } } };
  }
  console.error("Unexpected error:", error);
  return {
    status: 500,
    body: { error: { code: "INTERNAL_ERROR", message: "Something went wrong" } },
  };
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}
