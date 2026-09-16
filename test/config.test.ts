import { describe, it, expect } from "vitest";
import { loadConfig, assertAuthIsRunnable } from "../src/config.js";

describe("loadConfig", () => {
	it("defaults to production endpoint + auto provider + 15s timeout", () => {
		const cfg = loadConfig({});
		expect(cfg.endpoint).toBe("https://api.sentimentracker.com/api");
		expect(cfg.defaultProvider).toBe("auto");
		expect(cfg.requestTimeoutMs).toBe(15000);
		expect(cfg.sessionToken).toBeUndefined();
		expect(cfg.apiKey).toBeUndefined();
	});

	it("strips trailing slashes from endpoint", () => {
		const cfg = loadConfig({ SNT_SIGNALS_ENDPOINT: "https://staging.sentimentracker.com///" });
		expect(cfg.endpoint).toBe("https://staging.sentimentracker.com");
	});

	it("rejects malformed endpoint", () => {
		expect(() => loadConfig({ SNT_SIGNALS_ENDPOINT: "not-a-url" })).toThrow(/Invalid environment/);
	});

	it("rejects short tokens (likely paste error)", () => {
		expect(() => loadConfig({ SNT_SIGNALS_SESSION_TOKEN: "short" })).toThrow(/Invalid environment/);
	});

	it("clamps timeout to range", () => {
		expect(() => loadConfig({ SNT_SIGNALS_REQUEST_TIMEOUT_MS: "100" })).toThrow();
		expect(() => loadConfig({ SNT_SIGNALS_REQUEST_TIMEOUT_MS: "100000" })).toThrow();
	});

	it("accepts a known provider override", () => {
		const cfg = loadConfig({ SNT_SIGNALS_DEFAULT_PROVIDER: "hyperliquid" });
		expect(cfg.defaultProvider).toBe("hyperliquid");
	});

	it("rejects unknown provider", () => {
		expect(() => loadConfig({ SNT_SIGNALS_DEFAULT_PROVIDER: "kraken" })).toThrow();
	});
});

describe("assertAuthIsRunnable", () => {
	it("throws when neither session nor api key is configured", () => {
		const cfg = loadConfig({});
		expect(() => assertAuthIsRunnable(cfg)).toThrow(/credentials/);
	});

	it("passes with session token only", () => {
		const cfg = loadConfig({ SNT_SIGNALS_SESSION_TOKEN: "x".repeat(40) });
		expect(() => assertAuthIsRunnable(cfg)).not.toThrow();
	});

	it("passes with api key only", () => {
		const cfg = loadConfig({ SNT_SIGNALS_API_KEY: "x".repeat(40) });
		expect(() => assertAuthIsRunnable(cfg)).not.toThrow();
	});
});
