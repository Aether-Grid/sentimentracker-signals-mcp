/**
 * propose_trade_from_signal — compose a Hyperliquid order payload from a
 * signal envelope.
 *
 * Pure compute: no IO, no HTTP, no auth. Takes the raw signal output (the
 * `signal` field from `get_indicator_signal` or `subscribe_signal`), a
 * sizing strategy, current mark price, and emits a JSON object shaped
 * EXACTLY like the input to `@sentimentracker/hyperliquid-mcp`'s
 * `propose_order` tool. The agent then pipes this result into the sister
 * MCP, which runs its own safety rails (max notional, allowlist) before
 * signing.
 *
 * Three sizing modes:
 *   - `notionalUsd`: target a specific dollar amount; size = notionalUsd / markPx
 *   - `fixedBase`: target a specific base quantity (e.g. 0.01 BTC)
 *   - `riskUsd` (with `stopLossPx`): size = riskUsd / abs(markPx - stopLossPx)
 *
 * Trade direction comes from the signal:
 *   - signal.type === "BUY"  → side: "buy"
 *   - signal.type === "SELL" → side: "sell"
 *   - missing / other        → schema rejects
 *
 * Order type defaults to `market` (agent expects immediate fill on a fresh
 * signal). Override to `limit` with `limitOffsetBps` to place a passive
 * order at markPx ± bps.
 */

import { z } from "zod";
import { defineTool, SymbolSchema } from "./_shared.js";
import { InputError } from "../errors.js";

const SidedSignalSchema = z.object({
	type: z.enum(["BUY", "SELL"]),
	time: z.number().int().positive().optional(),
});

const SizingStrategySchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("notionalUsd"), notionalUsd: z.number().positive() }),
	z.object({ kind: z.literal("fixedBase"), sizeBase: z.number().positive() }),
	z.object({
		kind: z.literal("riskUsd"),
		riskUsd: z.number().positive(),
		stopLossPx: z.number().positive(),
	}),
]);

const InputSchema = z.object({
	signal: SidedSignalSchema,
	coin: SymbolSchema.transform((s) => s.toUpperCase()),
	markPx: z.number().positive(),
	sizing: SizingStrategySchema,
	isPerp: z.boolean().default(true),
	orderType: z.enum(["market", "limit"]).default("market"),
	/** For `orderType=limit`: passive offset from mark in basis points. Positive = away from mark in user's favour. */
	limitOffsetBps: z.number().int().min(0).max(1000).default(10),
	reduceOnly: z.boolean().default(false),
	tif: z.enum(["Gtc", "Ioc", "Alo"]).optional(),
	/** Optional take-profit / stop-loss to attach via the sister MCP's `place_tpsl`. */
	takeProfitPx: z.number().positive().optional(),
	stopLossPx: z.number().positive().optional(),
});

export const proposeTradeFromSignal = defineTool({
	name: "propose_trade_from_signal",
	title: "Compose Hyperliquid order payload",
	// Pure compute: never leaves the process, so not open world.
	annotations: { openWorldHint: false },
	description:
		"PURE COMPUTE: compose a Hyperliquid `propose_order` payload from a signal envelope + sizing strategy. " +
		"No IO. The result drops directly into `@sentimentracker/hyperliquid-mcp`'s `propose_order` tool. Three " +
		"sizing modes — notionalUsd / fixedBase / riskUsd (with stopLossPx). Optional `takeProfitPx` + `stopLossPx` " +
		"surface a follow-up tip to invoke `place_tpsl` after the entry fills.",
	inputSchema: InputSchema,
	handler: async (input) => {
		const side: "buy" | "sell" = input.signal.type === "BUY" ? "buy" : "sell";
		const sizeBase = computeSizeBase(input.sizing, input.markPx, side);

		let limitPx: number | undefined;
		if (input.orderType === "limit") {
			const bpsFactor = input.limitOffsetBps / 10_000;
			// Buys → place below mark; sells → place above mark (passive both ways).
			limitPx = side === "buy" ? input.markPx * (1 - bpsFactor) : input.markPx * (1 + bpsFactor);
		}

		const hlProposeOrderInput: Record<string, unknown> = {
			coin: input.coin,
			side,
			type: input.orderType,
			sizeBase,
			markPx: input.markPx,
			isPerp: input.isPerp,
			reduceOnly: input.reduceOnly,
		};
		if (limitPx !== undefined) hlProposeOrderInput.limitPx = limitPx;
		if (input.tif) hlProposeOrderInput.tif = input.tif;

		const followUp: Record<string, unknown> = {};
		if (input.takeProfitPx !== undefined || input.stopLossPx !== undefined) {
			followUp.placeTpsl = {
				tool: "place_tpsl",
				server: "sentimentracker-hyperliquid",
				arguments: {
					coin: input.coin,
					...(input.takeProfitPx !== undefined ? { takeProfitPx: input.takeProfitPx } : {}),
					...(input.stopLossPx !== undefined ? { stopLossPx: input.stopLossPx } : {}),
				},
			};
		}

		return {
			source: {
				signalType: input.signal.type,
				signalTime: input.signal.time ?? null,
				coin: input.coin,
				markPx: input.markPx,
				sizing: input.sizing,
			},
			derived: {
				side,
				sizeBase,
				notionalUsd: sizeBase * input.markPx,
				limitPx: limitPx ?? null,
			},
			next: {
				tool: "propose_order",
				server: "sentimentracker-hyperliquid",
				arguments: hlProposeOrderInput,
			},
			...(Object.keys(followUp).length > 0 ? { followUp } : {}),
			instructions:
				"Pipe `next.arguments` into the `propose_order` tool on the `sentimentracker-hyperliquid` MCP server. " +
				"If the proposal looks correct, run `place_order` with the same arguments. " +
				"If `followUp.placeTpsl` is present, run that tool AFTER the entry fills.",
		};
	},
});

function computeSizeBase(
	sizing: z.infer<typeof SizingStrategySchema>,
	markPx: number,
	_side: "buy" | "sell",
): number {
	switch (sizing.kind) {
		case "notionalUsd":
			return sizing.notionalUsd / markPx;
		case "fixedBase":
			return sizing.sizeBase;
		case "riskUsd": {
			const perUnitRisk = Math.abs(markPx - sizing.stopLossPx);
			if (perUnitRisk <= 0) {
				throw new InputError(
					"INPUT_INVALID",
					"stopLossPx is equal to markPx — per-unit risk is zero, can't size from risk budget.",
				);
			}
			return sizing.riskUsd / perUnitRisk;
		}
	}
}
