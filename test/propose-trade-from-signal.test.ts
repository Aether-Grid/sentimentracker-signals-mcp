/**
 * Tests for propose_trade_from_signal — pure compute, no IO, so we drive the
 * underlying tool handler directly without spinning up a server.
 */

import { describe, it, expect } from "vitest";
import { proposeTradeFromSignal } from "../src/tools/propose-trade-from-signal.js";
import { loadConfig } from "../src/config.js";
import { SignalsClient } from "../src/client.js";

const cfg = loadConfig({
	SNT_SIGNALS_ENDPOINT: "https://api.test.local",
	SNT_SIGNALS_SESSION_TOKEN: "x".repeat(40),
});
const ctx = { cfg, client: new SignalsClient(cfg) };

async function runTool(args: unknown) {
	const result = await proposeTradeFromSignal.buildHandler(ctx)(args);
	if (result.isError) return { isError: true, payload: JSON.parse((result.content[0] as { text: string }).text) };
	return { isError: false, payload: JSON.parse((result.content[0] as { text: string }).text) };
}

describe("propose_trade_from_signal", () => {
	it("BUY signal + notionalUsd sizing → market buy on the perp", async () => {
		const out = await runTool({
			signal: { type: "BUY", time: 1719120000000 },
			coin: "BTC",
			markPx: 60000,
			sizing: { kind: "notionalUsd", notionalUsd: 600 },
		});
		expect(out.isError).toBe(false);
		expect(out.payload.derived.side).toBe("buy");
		expect(out.payload.derived.sizeBase).toBe(0.01);
		expect(out.payload.derived.notionalUsd).toBe(600);
		expect(out.payload.next.tool).toBe("propose_order");
		expect(out.payload.next.server).toBe("sentimentracker-hyperliquid");
		expect(out.payload.next.arguments.type).toBe("market");
		expect(out.payload.next.arguments.coin).toBe("BTC");
		expect(out.payload.next.arguments.side).toBe("buy");
	});

	it("SELL signal + fixedBase sizing → market sell", async () => {
		const out = await runTool({
			signal: { type: "SELL" },
			coin: "eth",
			markPx: 3500,
			sizing: { kind: "fixedBase", sizeBase: 0.5 },
		});
		expect(out.payload.derived.side).toBe("sell");
		expect(out.payload.derived.sizeBase).toBe(0.5);
		expect(out.payload.derived.notionalUsd).toBe(1750);
		expect(out.payload.next.arguments.coin).toBe("ETH"); // uppercased
	});

	it("riskUsd sizing → divides risk budget by per-unit risk", async () => {
		const out = await runTool({
			signal: { type: "BUY", time: 1719120000000 },
			coin: "BTC",
			markPx: 60000,
			sizing: { kind: "riskUsd", riskUsd: 100, stopLossPx: 59000 },
			stopLossPx: 59000,
		});
		expect(out.payload.derived.sizeBase).toBe(0.1); // $100 / $1000 risk = 0.1
		expect(out.payload.followUp).toBeDefined();
		expect(out.payload.followUp.placeTpsl.arguments.stopLossPx).toBe(59000);
	});

	it("riskUsd with stopLossPx === markPx → INPUT_INVALID", async () => {
		const out = await runTool({
			signal: { type: "BUY" },
			coin: "BTC",
			markPx: 60000,
			sizing: { kind: "riskUsd", riskUsd: 100, stopLossPx: 60000 },
		});
		expect(out.isError).toBe(true);
		expect(out.payload.code).toBe("INPUT_INVALID");
	});

	it("orderType=limit BUY → limitPx is below markPx by the configured bps", async () => {
		const out = await runTool({
			signal: { type: "BUY" },
			coin: "BTC",
			markPx: 60000,
			sizing: { kind: "notionalUsd", notionalUsd: 600 },
			orderType: "limit",
			limitOffsetBps: 50, // 0.5%
		});
		expect(out.payload.next.arguments.type).toBe("limit");
		expect(out.payload.next.arguments.limitPx).toBeCloseTo(60000 * 0.995, 6);
	});

	it("orderType=limit SELL → limitPx is above markPx", async () => {
		const out = await runTool({
			signal: { type: "SELL" },
			coin: "BTC",
			markPx: 60000,
			sizing: { kind: "notionalUsd", notionalUsd: 600 },
			orderType: "limit",
			limitOffsetBps: 50,
		});
		expect(out.payload.next.arguments.limitPx).toBeCloseTo(60000 * 1.005, 6);
	});

	it("both TP + SL set → followUp.placeTpsl contains both, targets sister MCP", async () => {
		const out = await runTool({
			signal: { type: "BUY", time: 1719120000000 },
			coin: "BTC",
			markPx: 60000,
			sizing: { kind: "notionalUsd", notionalUsd: 600 },
			takeProfitPx: 62000,
			stopLossPx: 58000,
		});
		expect(out.payload.followUp.placeTpsl.tool).toBe("place_tpsl");
		expect(out.payload.followUp.placeTpsl.server).toBe("sentimentracker-hyperliquid");
		expect(out.payload.followUp.placeTpsl.arguments).toEqual({
			coin: "BTC",
			takeProfitPx: 62000,
			stopLossPx: 58000,
		});
	});

	it("no TP + no SL → followUp absent", async () => {
		const out = await runTool({
			signal: { type: "BUY" },
			coin: "BTC",
			markPx: 60000,
			sizing: { kind: "notionalUsd", notionalUsd: 600 },
		});
		expect(out.payload.followUp).toBeUndefined();
	});

	it("invalid signal.type (HOLD) → schema rejects", async () => {
		const out = await runTool({
			signal: { type: "HOLD" },
			coin: "BTC",
			markPx: 60000,
			sizing: { kind: "notionalUsd", notionalUsd: 600 },
		});
		expect(out.isError).toBe(true);
	});

	it("output is pure — same input twice produces identical results", async () => {
		const args = {
			signal: { type: "BUY", time: 1719120000000 },
			coin: "BTC",
			markPx: 60000,
			sizing: { kind: "notionalUsd", notionalUsd: 600 },
		};
		const a = await runTool(args);
		const b = await runTool(args);
		expect(JSON.stringify(a.payload)).toBe(JSON.stringify(b.payload));
	});
});
