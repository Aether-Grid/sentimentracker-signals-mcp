/**
 * Tests for SignalsClient.subscribe (the long-poll path) — drives fetch
 * with a vi.fn to assert request shape and response unwrap, identical
 * pattern to client.test.ts.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { SignalsClient } from "../src/client.js";
import { AuthError, BackendError } from "../src/errors.js";

const cfg = loadConfig({
	SNT_SIGNALS_ENDPOINT: "https://api.test.local",
	SNT_SIGNALS_SESSION_TOKEN: "x".repeat(40),
});

const ORIGINAL_FETCH = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = ORIGINAL_FETCH;
});

describe("SignalsClient.subscribe", () => {
	it("POSTs to /superchart/indicators/subscribe with watermark + timeout in body", async () => {
		const spy = vi.fn(async () =>
			new Response(
				JSON.stringify({ data: { signal: { time: 1719120000000, type: "BUY" }, waitedMs: 1234 } }),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		globalThis.fetch = spy as unknown as typeof fetch;

		const client = new SignalsClient(cfg);
		const result = await client.subscribe({
			indicator: "sniperV3",
			symbol: "BTC",
			resolution: "15",
			lastSeenSignalTs: 1719000000000,
			timeoutMs: 20000,
			provider: "hyperliquid",
		});

		expect(spy).toHaveBeenCalledTimes(1);
		const [url, init] = spy.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.test.local/superchart/indicators/subscribe");
		expect(init.method).toBe("POST");
		const body = JSON.parse(init.body as string);
		expect(body).toEqual({
			indicator: "sniperV3",
			symbol: "BTC",
			resolution: "15",
			lastSeenSignalTs: 1719000000000,
			timeoutMs: 20000,
			provider: "hyperliquid",
		});
		expect(result.data.signal).toEqual({ time: 1719120000000, type: "BUY" });
		expect(result.data.waitedMs).toBe(1234);
	});

	it("omits provider when 'auto'", async () => {
		const spy = vi.fn(async () =>
			new Response(JSON.stringify({ data: { signal: null, waitedMs: 25000, timedOut: true } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		globalThis.fetch = spy as unknown as typeof fetch;
		const client = new SignalsClient(cfg);
		await client.subscribe({ indicator: "sniperV3", symbol: "BTC", resolution: "15", provider: "auto" });
		const body = JSON.parse((spy.mock.calls[0]?.[1] as RequestInit).body as string);
		expect(body).not.toHaveProperty("provider");
	});

	it("handles timeout response (signal:null + timedOut:true)", async () => {
		globalThis.fetch = vi.fn(async () =>
			new Response(JSON.stringify({ data: { signal: null, waitedMs: 25000, timedOut: true } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		) as unknown as typeof fetch;
		const client = new SignalsClient(cfg);
		const result = await client.subscribe({ indicator: "sniperV3", symbol: "BTC", resolution: "15" });
		expect(result.data.signal).toBeNull();
		expect(result.data.timedOut).toBe(true);
	});

	it("401 → AuthError(AUTH_EXPIRED)", async () => {
		globalThis.fetch = vi.fn(async () =>
			new Response(JSON.stringify({ message: "Session expired" }), {
				status: 401,
				headers: { "content-type": "application/json" },
			}),
		) as unknown as typeof fetch;
		const client = new SignalsClient(cfg);
		await expect(
			client.subscribe({ indicator: "sniperV3", symbol: "BTC", resolution: "15" }),
		).rejects.toBeInstanceOf(AuthError);
	});

	it("malformed body → BACKEND_INVALID_RESPONSE", async () => {
		globalThis.fetch = vi.fn(async () =>
			new Response(JSON.stringify({ data: { weirdShape: true } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		) as unknown as typeof fetch;
		const client = new SignalsClient(cfg);
		await expect(
			client.subscribe({ indicator: "sniperV3", symbol: "BTC", resolution: "15" }),
		).rejects.toMatchObject({ code: "BACKEND_INVALID_RESPONSE" });
	});

	it("network error → BACKEND_HTTP_ERROR", async () => {
		globalThis.fetch = vi.fn(async () => {
			throw new TypeError("fetch failed");
		}) as unknown as typeof fetch;
		const client = new SignalsClient(cfg);
		await expect(
			client.subscribe({ indicator: "sniperV3", symbol: "BTC", resolution: "15" }),
		).rejects.toBeInstanceOf(BackendError);
	});
});
