import { ZodError } from "zod";

/**
 * Consistent application errors.
 * Services throw AppError; route handlers / server actions translate
 * them into a uniform shape via `toErrorResponse` / `getErrorMessage`.
 * Zod validation failures (routes parse request bodies with zod
 * schemas) map to 400 — before this branch existed they fell through
 * to the generic 500, so a malformed body looked like a server crash
 * (QA audit 2026-11-27).
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
  if (error instanceof ZodError) {
    const details = error.issues
      .slice(0, 3)
      .map((issue) => {
        const path = issue.path.join(".");
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join("; ");
    return {
      status: 400,
      body: {
        error: {
          code: "VALIDATION_ERROR",
          message: details ? `Invalid request — ${details}` : "Invalid request",
        },
      },
    };
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
