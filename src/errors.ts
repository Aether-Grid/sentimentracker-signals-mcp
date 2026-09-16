/**
 * Error hierarchy for the signals MCP.
 *
 * Three categories the LLM should branch on:
 *  - AuthError: missing credentials, expired session, premium required
 *  - BackendError: HTTP-level failure (timeout, 5xx, malformed response)
 *  - InputError: unknown indicator key, malformed symbol, etc.
 *
 * Mapped to MCP `isError: true` with structured `code` so downstream agents
 * can decide retry vs. operator-intervention vs. correct-input.
 */

export type ErrorCode =
	| "AUTH_MISSING"
	| "AUTH_EXPIRED"
	| "AUTH_PREMIUM_REQUIRED"
	| "BACKEND_TIMEOUT"
	| "BACKEND_HTTP_ERROR"
	| "BACKEND_RATE_LIMITED"
	| "BACKEND_INVALID_RESPONSE"
	| "INPUT_UNKNOWN_INDICATOR"
	| "INPUT_INVALID"
	| "RESULT_TOO_LARGE"
	| "INTERNAL_ERROR";

export interface ToolErrorPayload {
	readonly code: ErrorCode;
	readonly message: string;
	readonly hint?: string;
	readonly status?: number;
}

abstract class McpToolError extends Error {
	abstract readonly code: ErrorCode;
	readonly hint?: string;
	readonly status?: number;

	constructor(message: string, opts?: { hint?: string; status?: number; cause?: unknown }) {
		super(message, opts?.cause !== undefined ? { cause: opts.cause } : undefined);
		this.name = this.constructor.name;
		this.hint = opts?.hint;
		this.status = opts?.status;
	}

	toPayload(): ToolErrorPayload {
		return {
			code: this.code,
			message: this.message,
			...(this.hint ? { hint: this.hint } : {}),
			...(this.status ? { status: this.status } : {}),
		};
	}
}

export class AuthError extends McpToolError {
	readonly code: ErrorCode;
	constructor(code: Extract<ErrorCode, `AUTH_${string}`>, message: string, hint?: string) {
		super(message, hint !== undefined ? { hint } : {});
		this.code = code;
	}
}

export class BackendError extends McpToolError {
	readonly code: ErrorCode;
	constructor(
		code: Extract<ErrorCode, `BACKEND_${string}`>,
		message: string,
		opts?: { hint?: string; status?: number; cause?: unknown },
	) {
		super(message, opts);
		this.code = code;
	}
}

export class InputError extends McpToolError {
	readonly code: ErrorCode;
	constructor(code: Extract<ErrorCode, `INPUT_${string}`>, message: string, hint?: string) {
		super(message, hint !== undefined ? { hint } : {});
		this.code = code;
	}
}

export class InternalError extends McpToolError {
	readonly code = "INTERNAL_ERROR" as const;
}

/** A successful backend answer that is too big to hand to a model; the caller must narrow the request. */
export class ResultTooLargeError extends McpToolError {
	readonly code = "RESULT_TOO_LARGE" as const;
}

export function toErrorPayload(err: unknown): ToolErrorPayload {
	if (err instanceof McpToolError) return err.toPayload();
	if (err instanceof Error) return new InternalError(err.message).toPayload();
	return new InternalError(String(err)).toPayload();
}
