/**
 * HTTP client for the Sentimentracker backend indicator routes:
 *
 *   GET  /superchart/indicators            — catalog
 *   POST /superchart/indicators/calculate  — compute one indicator
 *   POST /superchart/indicators/subscribe  — long-poll for the next signal
 *
 * Thin wrapper — no caching here (backend already has a 60s indicator
 * cache + single-flight dedup keyed on (indicator, symbol, resolution, bar
 * close ts, params hash)).
 *
 * Auth: either `Authorization: Bearer <jwt>` (session token) or
 * `x-sentimentracker-api-key: snt_mcp_<…>` (API key). Header chosen
 * automatically based on which env var is set.
 *
 * Errors: backend's `{ message, ... }` envelope is mapped onto our typed
 * `AuthError` / `BackendError` so callers can branch on `error.code`.
 */

import type { IndicatorMeta } from "./catalog.js";
import type { Config } from "./config.js";
import { AuthError, BackendError } from "./errors.js";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";

const CATALOG_PATH = "/superchart/indicators";
const CALCULATE_PATH = "/superchart/indicators/calculate";
const SUBSCRIBE_PATH = "/superchart/indicators/subscribe";

/** Slack added to a long-poll's server hold so the network round trip does not cut it short. */
const SUBSCRIBE_SLACK_MS = 5_000;
const DEFAULT_SUBSCRIBE_TIMEOUT_MS = 25_000;

export interface CalculateParams {
	indicator: string;
	symbol: string;
	resolution: string;
	config?: Record<string, unknown>;
	from?: number;
	metadataOnly?: boolean;
	provider?: string;
}

export interface CalculateResponse {
	/** Status flag from the backend's SuccessResponse envelope. */
	success?: boolean;
	/** The actual calculator output — shape varies per indicator. */
	data: Record<string, unknown>;
	/** "Calculated successfully" / "Calculated successfully (cached)". */
	message?: string;
}

export interface SubscribeParams {
	indicator: string;
	symbol: string;
	resolution: string;
	config?: Record<string, unknown>;
	provider?: string;
	/** Only return signals strictly newer than this ms epoch. Defaults to 0. */
	lastSeenSignalTs?: number;
	/** Hold the connection up to this many ms; clamped 1000-50000 by backend. */
	timeoutMs?: number;
}

export interface SubscribeResponse {
	success?: boolean;
	data: {
		signal: { time: number; type?: string } | null;
		waitedMs: number;
		timedOut?: boolean;
	};
	message?: string;
}

export interface CatalogResponse {
	success?: boolean;
	data: { count: number; indicators: IndicatorMeta[] };
}

interface RequestSpec<T> {
	method: "GET" | "POST";
	path: string;
	body?: Record<string, unknown>;
	timeoutMs: number;
	/** Shape check on the parsed JSON; a miss is a BACKEND_INVALID_RESPONSE. */
	guard: (v: unknown) => v is T;
	guardMessage: string;
}

export class SignalsClient {
	constructor(private readonly cfg: Config) {}

	async listIndicators(): Promise<CatalogResponse> {
		return this.request({
			method: "GET",
			path: CATALOG_PATH,
			timeoutMs: this.cfg.requestTimeoutMs,
			guard: isCatalogResponseShape,
			guardMessage: "catalog response missing expected `data.indicators` array",
		});
	}

	async calculate(params: CalculateParams): Promise<CalculateResponse> {
		return this.request({
			method: "POST",
			path: CALCULATE_PATH,
			body: {
				indicator: params.indicator,
				symbol: params.symbol,
				resolution: params.resolution,
				...(params.config ? { config: params.config } : {}),
				...(params.from !== undefined ? { from: params.from } : {}),
				...(params.metadataOnly !== undefined ? { metadataOnly: params.metadataOnly } : {}),
				...(params.provider && params.provider !== "auto" ? { provider: params.provider } : {}),
			},
			timeoutMs: this.cfg.requestTimeoutMs,
			guard: isCalcResponseShape,
			guardMessage: "Response missing expected `data` field",
		});
	}

	/**
	 * Long-poll subscription. The backend holds the connection for up to
	 * `timeoutMs` (server-clamped 1000-50000ms) and returns as soon as it
	 * sees a signal newer than `lastSeenSignalTs`; the local timeout covers
	 * that hold plus slack.
	 */
	async subscribe(params: SubscribeParams): Promise<SubscribeResponse> {
		return this.request({
			method: "POST",
			path: SUBSCRIBE_PATH,
			body: {
				indicator: params.indicator,
				symbol: params.symbol,
				resolution: params.resolution,
				...(params.config ? { config: params.config } : {}),
				...(params.provider && params.provider !== "auto" ? { provider: params.provider } : {}),
				...(params.lastSeenSignalTs !== undefined ? { lastSeenSignalTs: params.lastSeenSignalTs } : {}),
				...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
			},
			timeoutMs: (params.timeoutMs ?? DEFAULT_SUBSCRIBE_TIMEOUT_MS) + SUBSCRIBE_SLACK_MS,
			guard: isSubscribeResponseShape,
			guardMessage: "subscribe response missing expected `data.signal` field",
		});
	}

	private async request<T>(spec: RequestSpec<T>): Promise<T> {
		const url = `${this.cfg.endpoint}${spec.path}`;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), spec.timeoutMs);
		let response: Response;
		try {
			response = await fetch(url, {
				method: spec.method,
				headers: this.buildHeaders(),
				...(spec.body ? { body: JSON.stringify(spec.body) } : {}),
				signal: controller.signal,
			});
		} catch (err) {
			if (err instanceof Error && err.name === "AbortError") {
				throw new BackendError("BACKEND_TIMEOUT", `${spec.method} ${url} timed out after ${spec.timeoutMs}ms`, {
					hint: "Increase SNT_SIGNALS_REQUEST_TIMEOUT_MS or check backend health.",
				});
			}
			throw new BackendError("BACKEND_HTTP_ERROR", err instanceof Error ? err.message : String(err), {
				cause: err,
			});
		} finally {
			clearTimeout(timer);
		}

		const text = await response.text();
		if (!response.ok) this.throwForStatus(response, text);

		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			throw new BackendError("BACKEND_INVALID_RESPONSE", `Response is not valid JSON (status ${response.status})`, {
				status: response.status,
			});
		}
		if (!spec.guard(parsed)) {
			throw new BackendError("BACKEND_INVALID_RESPONSE", spec.guardMessage, { status: response.status });
		}
		return parsed;
	}

	private buildHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			"content-type": "application/json",
			accept: "application/json",
			"user-agent": `${SERVER_NAME}/${SERVER_VERSION}`,
		};
		if (this.cfg.sessionToken) headers.authorization = `Bearer ${this.cfg.sessionToken}`;
		else if (this.cfg.apiKey) headers["x-sentimentracker-api-key"] = this.cfg.apiKey;
		return headers;
	}

	private throwForStatus(response: Response, text: string): never {
		const status = response.status;
		const msg = extractBackendMessage(text) ?? `HTTP ${status}`;
		if (status === 401) {
			throw new AuthError(
				"AUTH_EXPIRED",
				msg,
				"The session token expired or the API key was revoked or expired. Rotate the key in Settings → API keys.",
			);
		}
		if (status === 403) {
			throw new AuthError(
				"AUTH_PREMIUM_REQUIRED",
				msg,
				"Indicators need a Sentimentracker premium subscription and an API key with the signals:read scope.",
			);
		}
		if (status === 429) {
			const retryAfter = response.headers.get("retry-after");
			throw new BackendError("BACKEND_RATE_LIMITED", msg, {
				status,
				hint: retryAfter ? `Retry after ${retryAfter}s.` : "Slow down and retry.",
			});
		}
		throw new BackendError("BACKEND_HTTP_ERROR", msg, { status });
	}
}

function isCalcResponseShape(v: unknown): v is CalculateResponse {
	return typeof v === "object" && v !== null && "data" in v && typeof (v as { data: unknown }).data === "object";
}

function isSubscribeResponseShape(v: unknown): v is SubscribeResponse {
	if (typeof v !== "object" || v === null || !("data" in v)) return false;
	const d = (v as { data: unknown }).data;
	if (typeof d !== "object" || d === null) return false;
	return "signal" in d && "waitedMs" in d;
}

function isCatalogResponseShape(v: unknown): v is CatalogResponse {
	if (typeof v !== "object" || v === null || !("data" in v)) return false;
	const d = (v as { data: unknown }).data;
	return typeof d === "object" && d !== null && Array.isArray((d as { indicators?: unknown }).indicators);
}

function extractBackendMessage(text: string): string | null {
	try {
		const parsed = JSON.parse(text) as { message?: unknown };
		if (typeof parsed?.message === "string") return parsed.message;
	} catch {
		/* not JSON — fall through */
	}
	return null;
}
