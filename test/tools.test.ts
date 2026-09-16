import { describe, it, expect, vi } from "vitest";
import { IndicatorCatalog, type IndicatorMeta } from "../src/catalog.js";
import type { SignalsClient } from "../src/client.js";
import { loadConfig } from "../src/config.js";
import { getIndicatorFull } from "../src/tools/get-indicator-full.js";
import { getIndicatorSignal } from "../src/tools/get-indicator-signal.js";
import { getSignalConfluence } from "../src/tools/get-signal-confluence.js";
import { listIndicators } from "../src/tools/list-indicators.js";
import { proposeTradeFromSignal } from "../src/tools/propose-trade-from-signal.js";
import { allTools } from "../src/tools/index.js";
import { MAX_RESULT_BYTES, type ToolContext } from "../src/tools/_shared.js";

const cfg = loadConfig({
	SNT_SIGNALS_ENDPOINT: "https://api.test.local",
	SNT_SIGNALS_API_KEY: "snt_mcp_" + "x".repeat(24),
});

const META: IndicatorMeta[] = [
	{ key: "sniperV3", displayName: "Sniper v3", description: "band state", signalKind: "directional", schemaVersion: 1 },
	{ key: "momentumRadar", displayName: "Momentum Radar", description: "radar", signalKind: "regime", schemaVersion: 1 },
];

function fakeContext(calculate = vi.fn()): ToolContext & { calculate: typeof calculate } {
	const client = {
		listIndicators: vi.fn(async () => ({ data: { count: META.length, indicators: META } })),
		calculate,
		subscribe: vi.fn(),
	} as unknown as SignalsClient;
	return { cfg, client, catalog: new IndicatorCatalog(client), calculate };
}

describe("tool registry", () => {
	it("exposes 6 tools", () => {
		const names = allTools().map((t) => t.name);
		expect(names.sort()).toEqual(
			[
				"get_indicator_full",
				"get_indicator_signal",
				"get_signal_confluence",
				"list_indicators",
				"propose_trade_from_signal",
				"subscribe_signal",
			].sort(),
		);
	});

	it("every tool has a title and a non-trivial description", () => {
		for (const t of allTools()) {
			expect(t.definition.title.length).toBeGreaterThan(0);
			expect(t.definition.description.length).toBeGreaterThan(40);
		}
	});

	it("tool names are unique", () => {
		const names = allTools().map((t) => t.name);
		expect(new Set(names).size).toBe(names.length);
	});

	it("every tool is annotated read only and non destructive", () => {
		for (const t of allTools()) {
			expect(t.definition.annotations.readOnlyHint).toBe(true);
			expect(t.definition.annotations.destructiveHint).toBe(false);
		}
	});

	it("propose_trade_from_signal is closed world (pure compute), the rest reach the backend", () => {
		expect(proposeTradeFromSignal.definition.annotations.openWorldHint).toBe(false);
		expect(getIndicatorSignal.definition.annotations.openWorldHint).toBe(true);
	});
});

describe("list_indicators", () => {
	it("returns the live backend catalog as structured content", async () => {
		const ctx = fakeContext();
		const result = await listIndicators.buildHandler(ctx)({});
		expect(result.isError).toBeUndefined();
		expect(result.structuredContent).toMatchObject({ count: 2, source: "https://api.test.local" });
		expect(JSON.parse((result.content[0] as { text: string }).text).indicators[0].key).toBe("sniperV3");
	});
});

describe("get_indicator_signal", () => {
	it("decorates the backend metadata with catalog fields", async () => {
		const calculate = vi.fn(async () => ({
			data: { metadata: { signals: [{ type: "BUY", time: 1 }] } },
			message: "Calculated successfully (cached)",
		}));
		const ctx = fakeContext(calculate);
		const result = await getIndicatorSignal.buildHandler(ctx)({
			indicator: "sniperV3",
			symbol: "Binance:BTC/USDT",
			resolution: "15",
		});
		expect(result.isError).toBeUndefined();
		expect(result.structuredContent).toMatchObject({
			indicator: "sniperV3",
			displayName: "Sniper v3",
			signalKind: "directional",
			cached: true,
			metadata: { signals: [{ type: "BUY", time: 1 }] },
		});
		expect(calculate).toHaveBeenCalledWith(
			expect.objectContaining({ indicator: "sniperV3", metadataOnly: true }),
		);
	});

	it("rejects a key the backend does not know before calling calculate", async () => {
		const ctx = fakeContext();
		const result = await getIndicatorSignal.buildHandler(ctx)({
			indicator: "nope",
			symbol: "BTC",
			resolution: "15",
		});
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({ code: "INPUT_UNKNOWN_INDICATOR" });
		expect(ctx.calculate).not.toHaveBeenCalled();
	});
});

describe("get_signal_confluence", () => {
	it("fails the whole call on one unknown key without fetching", async () => {
		const ctx = fakeContext();
		const result = await getSignalConfluence.buildHandler(ctx)({
			indicators: ["sniperV3", "nope"],
			symbol: "BTC",
			resolution: "60",
		});
		expect(result.isError).toBe(true);
		expect(ctx.calculate).not.toHaveBeenCalled();
	});

	it("reports one row per indicator, errors isolated per row", async () => {
		const calculate = vi.fn(async ({ indicator }: { indicator: string }) => {
			if (indicator === "momentumRadar") throw new Error("boom");
			return { data: { metadata: { signals: [{ type: "SELL", time: 9 }] } } };
		});
		const ctx = fakeContext(calculate);
		const result = await getSignalConfluence.buildHandler(ctx)({
			indicators: ["sniperV3", "momentumRadar"],
			symbol: "BTC",
			resolution: "60",
		});
		expect(result.isError).toBeUndefined();
		const rows = (result.structuredContent as { rows: Array<Record<string, unknown>> }).rows;
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({ indicator: "sniperV3", latestSide: "SELL", latestTs: 9, error: null });
		expect(rows[1]).toMatchObject({ indicator: "momentumRadar", latestSide: null, error: "boom" });
	});
});

describe("result size cap", () => {
	it("refuses a full result over MAX_RESULT_BYTES with RESULT_TOO_LARGE", async () => {
		const huge = { series: new Array(Math.ceil(MAX_RESULT_BYTES / 4)).fill(null) };
		const ctx = fakeContext(vi.fn(async () => ({ data: huge })));
		const result = await getIndicatorFull.buildHandler(ctx)({ indicator: "sniperV3", symbol: "BTC", resolution: "60" });
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({ code: "RESULT_TOO_LARGE", hint: expect.stringContaining("get_indicator_signal") });
		expect((result.content[0] as { text: string }).text.length).toBeLessThan(2_000);
	});

	it("emits compact JSON text (no pretty printing)", async () => {
		const ctx = fakeContext(vi.fn(async () => ({ data: { metadata: { signals: [] } } })));
		const result = await getIndicatorSignal.buildHandler(ctx)({ indicator: "sniperV3", symbol: "BTC", resolution: "60" });
		expect((result.content[0] as { text: string }).text).not.toMatch(/\n/);
	});
});
