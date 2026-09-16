/**
 * Environment configuration.
 *
 * Auth model — two paths, either works against the premium-gated backend:
 *
 *   1. Session token: pass an authenticated Sentimentracker session JWT via
 *      `SNT_SIGNALS_SESSION_TOKEN`. Easiest for quick dev — log into
 *      sentimentracker.com, copy the session cookie / bearer, paste into env.
 *      Expires (typically 7-30 days); refresh manually.
 *   2. API key (recommended for headless / production): mint in Settings →
 *      API keys (or `POST /api-keys`), set `SNT_SIGNALS_API_KEY=snt_mcp_…`.
 *      Backend's `apiKeyOrJwtMiddleware` reads the `x-sentimentracker-api-key`
 *      header we send. Keys expire one year after minting and can be
 *      rotated (the old key keeps working for 24h); a 401 with a key means
 *      it expired or was revoked.
 *
 * `endpoint` defaults to the production backend INCLUDING its `/api` prefix
 * (https://api.sentimentracker.com/api); staging is
 * https://api-stg.sentimentracker.com/api.
 */

import { z } from "zod";

const envSchema = z
	.object({
		SNT_SIGNALS_ENDPOINT: z.string().url().default("https://api.sentimentracker.com/api"),
		SNT_SIGNALS_SESSION_TOKEN: z.string().min(20).optional(),
		SNT_SIGNALS_API_KEY: z.string().min(20).optional(),
		SNT_SIGNALS_DEFAULT_PROVIDER: z
			.enum(["auto", "hyperliquid", "binance", "tiingo", "intrinio", "databento"])
			.default("auto"),
		SNT_SIGNALS_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
	})
	.transform((v) => ({
		endpoint: v.SNT_SIGNALS_ENDPOINT.replace(/\/+$/, ""),
		sessionToken: v.SNT_SIGNALS_SESSION_TOKEN,
		apiKey: v.SNT_SIGNALS_API_KEY,
		defaultProvider: v.SNT_SIGNALS_DEFAULT_PROVIDER,
		requestTimeoutMs: v.SNT_SIGNALS_REQUEST_TIMEOUT_MS,
	}));

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const parsed = envSchema.safeParse(env);
	if (!parsed.success) {
		const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
		throw new Error(`Invalid environment configuration:\n${issues}`);
	}
	return parsed.data;
}

export function assertAuthIsRunnable(cfg: Config): void {
	if (!cfg.sessionToken && !cfg.apiKey) {
		throw new Error(
			"No credentials configured. Set SNT_SIGNALS_API_KEY (recommended for headless use; mint via POST /api-keys) or SNT_SIGNALS_SESSION_TOKEN (session JWT for quick dev).",
		);
	}
}
