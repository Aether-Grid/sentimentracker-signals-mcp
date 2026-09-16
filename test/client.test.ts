import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { SignalsClient } from "../src/client.js";
import { AuthError, BackendError } from "../src/errors.js";

const cfg = loadConfig({
	SNT_SIGNALS_ENDPOINT: "https://api.test.local",
	SNT_SIGNALS_SESSION_TOKEN: "x".repeat(40),
});

const ORIGINAL_FETCH = globalThis.fetch;

describe("SignalsClient.calculate", () => {
	beforeEach(() => {
		// Replace fetch with a vi.fn so each test asserts shape independently
	});

	afterEach(() => {
		globalThis.fetch = ORIGINAL_FETCH;
	});

	it("POSTs to /superchart/indicators/calculate with bearer token + JSON body", async () => {
		const spy = vi.fn(async () =>
			new Response(JSON.stringify({ data: { metadata: { signals: [] } } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		globalThis.fetch = spy as unknown as typeof fetch;

		const client = new SignalsClient(cfg);
		await client.calculate({
			indicator: "sniperV3",
			symbol: "BTC",
			resolution: "15",
			metadataOnly: true,
			provider: "hyperliquid",
		});

		expect(spy).toHaveBeenCalledTimes(1);
		const call = spy.mock.calls[0];
		expect(call).toBeDefined();
		const [url, init] = call as [string, RequestInit];
		expect(url).toBe("https://api.test.local/superchart/indicators/calculate");
		expect(init.method).toBe("POST");
		const headers = init.headers as Record<string, string>;
		expect(headers.authorization).toBe(`Bearer ${"x".repeat(40)}`);
		expect(headers["content-type"]).toBe("application/json");
		const body = JSON.parse(init.body as string);
		expect(body).toEqual({
			indicator: "sniperV3",
			symbol: "BTC",
			resolution: "15",
			metadataOnly: true,
			provider: "hyperliquid",
		});
	});

	it("omits `provider` from body when caller passes 'auto'", async () => {
		const spy = vi.fn(async () =>
			new Response(JSON.stringify({ data: {} }), { status: 200, headers: { "content-type": "application/json" } }),
		);
		globalThis.fetch = spy as unknown as typeof fetch;

		const client = new SignalsClient(cfg);
		await client.calculate({ indicator: "sniperV3", symbol: "BTC", resolution: "15", provider: "auto" });
		const init = spy.mock.calls[0]?.[1] as RequestInit;
		const body = JSON.parse(init.body as string);
		expect(body).not.toHaveProperty("provider");
	});

	it("maps 401 → AuthError(AUTH_EXPIRED)", async () => {
		globalThis.fetch = vi.fn(async () =>
			new Response(JSON.stringify({ message: "Session expired" }), {
				status: 401,
				headers: { "content-type": "application/json" },
			}),
		) as unknown as typeof fetch;
		const client = new SignalsClient(cfg);
		try {
			await client.calculate({ indicator: "sniperV3", symbol: "BTC", resolution: "15" });
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(AuthError);
			expect((err as AuthError).code).toBe("AUTH_EXPIRED");
		}
	});

	it("maps 403 → AuthError(AUTH_PREMIUM_REQUIRED)", async () => {
		globalThis.fetch = vi.fn(async () =>
			new Response(JSON.stringify({ message: "Premium subscription required for indicators" }), {
				status: 403,
				headers: { "content-type": "application/json" },
			}),
		) as unknown as typeof fetch;
		const client = new SignalsClient(cfg);
		try {
			await client.calculate({ indicator: "sniperV3", symbol: "BTC", resolution: "15" });
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(AuthError);
			expect((err as AuthError).code).toBe("AUTH_PREMIUM_REQUIRED");
		}
	});

	it("maps 5xx → BackendError(BACKEND_HTTP_ERROR)", async () => {
		globalThis.fetch = vi.fn(async () =>
			new Response(JSON.stringify({ message: "boom" }), {
				status: 502,
				headers: { "content-type": "application/json" },
			}),
		) as unknown as typeof fetch;
		const client = new SignalsClient(cfg);
		try {
			await client.calculate({ indicator: "sniperV3", symbol: "BTC", resolution: "15" });
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(BackendError);
			expect((err as BackendError).code).toBe("BACKEND_HTTP_ERROR");
			expect((err as BackendError).status).toBe(502);
		}
	});

	it("maps non-JSON response → BACKEND_INVALID_RESPONSE", async () => {
		globalThis.fetch = vi.fn(async () =>
			new Response("<html>oops</html>", { status: 200, headers: { "content-type": "text/html" } }),
		) as unknown as typeof fetch;
		const client = new SignalsClient(cfg);
		await expect(
			client.calculate({ indicator: "sniperV3", symbol: "BTC", resolution: "15" }),
		).rejects.toMatchObject({ code: "BACKEND_INVALID_RESPONSE" });
	});

	it("uses x-sentimentracker-api-key header when only API key is configured", async () => {
		const apiCfg = loadConfig({
			SNT_SIGNALS_ENDPOINT: "https://api.test.local",
			SNT_SIGNALS_API_KEY: "k".repeat(40),
		});
		const spy = vi.fn(async () =>
			new Response(JSON.stringify({ data: {} }), { status: 200, headers: { "content-type": "application/json" } }),
		);
		globalThis.fetch = spy as unknown as typeof fetch;
		const client = new SignalsClient(apiCfg);
		await client.calculate({ indicator: "sniperV3", symbol: "BTC", resolution: "15" });
		const headers = (spy.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
		expect(headers["x-sentimentracker-api-key"]).toBe("k".repeat(40));
		expect(headers.authorization).toBeUndefined();
	});
});

describe("SignalsClient.listIndicators", () => {
	afterEach(() => {
		globalThis.fetch = ORIGINAL_FETCH;
	});

	it("GETs the catalog with the versioned user agent", async () => {
		const spy = vi.fn(async () =>
			new Response(JSON.stringify({ data: { count: 1, indicators: [{ key: "sniperV3" }] } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		globalThis.fetch = spy as unknown as typeof fetch;
		const res = await new SignalsClient(cfg).listIndicators();
		expect(res.data.indicators[0]?.key).toBe("sniperV3");
		const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe("https://api.test.local/superchart/indicators");
		expect(init.method).toBe("GET");
		expect(init.body).toBeUndefined();
		expect((init.headers as Record<string, string>)["user-agent"]).toMatch(/^sentimentracker-signals-mcp\/\d+\.\d+\.\d+$/);
	});

	it("rejects a catalog without an indicators array", async () => {
		globalThis.fetch = vi.fn(async () =>
			new Response(JSON.stringify({ data: { nope: true } }), { status: 200 }),
		) as unknown as typeof fetch;
		await expect(new SignalsClient(cfg).listIndicators()).rejects.toMatchObject({
			code: "BACKEND_INVALID_RESPONSE",
		});
	});
});

describe("SignalsClient rate limit mapping", () => {
	afterEach(() => {
		globalThis.fetch = ORIGINAL_FETCH;
	});

	it("maps 429 to BACKEND_RATE_LIMITED with the Retry-After hint", async () => {
		globalThis.fetch = vi.fn(async () =>
			new Response(JSON.stringify({ message: "Signal rate limit exceeded" }), {
				status: 429,
				headers: { "retry-after": "7" },
			}),
		) as unknown as typeof fetch;
		await expect(
			new SignalsClient(cfg).calculate({ indicator: "sniperV3", symbol: "BTC", resolution: "15" }),
		).rejects.toMatchObject({
			code: "BACKEND_RATE_LIMITED",
			status: 429,
			hint: "Retry after 7s.",
		});
		expect(new BackendError("BACKEND_RATE_LIMITED", "x").code).toBe("BACKEND_RATE_LIMITED");
		expect(AuthError).toBeDefined();
	});
});
