/**
 * Shared zod schemas + the tool-handler wrapper. Every tool builds on
 * `defineTool` so the server gets uniform error envelopes, JSON content
 * shape, structured content, and MCP tool annotations.
 */

import { z } from "zod";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { IndicatorCatalog } from "../catalog.js";
import type { SignalsClient } from "../client.js";
import type { Config } from "../config.js";
import { ResultTooLargeError, toErrorPayload } from "../errors.js";

/** Bare tickers (BTC, AAPL), provider prefixed pairs (Binance:BTC/USDT) and vendor tickers (vntl:AAPL). */
export const SymbolSchema = z
	.string()
	.min(1)
	.max(40)
	.regex(/^[A-Za-z0-9_:.\/\-]+$/, "Symbol must be alphanumeric with optional : / . - (e.g. BTC, Binance:BTC/USDT, vntl:AAPL)");

/**
 * Backend resolution strings — same set the frontend chart picker uses.
 * `1` `3` `5` `15` `30` `45` `60` `120` `180` `240` `720` `D` `W` `M` …
 * Loose pattern — let backend reject what it doesn't support, schema is for
 * shape sanity not validity.
 */
export const ResolutionSchema = z
	.string()
	.min(1)
	.max(8)
	.regex(/^([0-9]+|[DWM]|[0-9]+[DWM])$/i, "Resolution must be a minute integer, D, W, M, or N(D|W|M).");

/**
 * Indicator keys are validated against the live catalog inside each
 * handler (`catalog.require`), not by an enum here: the backend registry
 * is the only list, so a new indicator needs no MCP release.
 */
export const IndicatorKeySchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[a-z][A-Za-z0-9]*$/, "Indicator key is camelCase, e.g. sniperV3")
	.describe("Indicator key as returned by list_indicators, e.g. sniperV3");

export const ProviderSchema = z.enum(["auto", "hyperliquid", "binance", "tiingo", "intrinio", "databento"]);

export interface ToolContext {
	readonly cfg: Config;
	readonly client: SignalsClient;
	readonly catalog: IndicatorCatalog;
}

export interface ToolDefinition<I extends z.ZodTypeAny, O extends Record<string, unknown>> {
	name: string;
	title?: string;
	description: string;
	inputSchema: I;
	/** Overrides on top of the read-only defaults every tool here shares. */
	annotations?: ToolAnnotations;
	handler: (input: z.infer<I>, ctx: ToolContext) => Promise<O>;
}

/**
 * Every tool in this server reads; none mutates state anywhere. The one
 * that composes an order (`propose_trade_from_signal`) only returns a
 * payload, so it stays read only and additionally closed world.
 */
const READ_ONLY_ANNOTATIONS: ToolAnnotations = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: true,
};

/**
 * Largest tool result we will hand back, in bytes of compact JSON. A full
 * per-bar payload can reach several MB (Momentum Radar on a long window
 * is ~5 MB), which no model can use and which the stdio transport chokes
 * on; the caller narrows the window with `from` or asks for the signal.
 */
export const MAX_RESULT_BYTES = 1_000_000;

export function defineTool<I extends z.ZodTypeAny, O extends Record<string, unknown>>(def: ToolDefinition<I, O>) {
	return {
		name: def.name,
		definition: {
			title: def.title ?? def.name,
			description: def.description,
			inputSchema: (def.inputSchema as unknown as z.ZodObject<z.ZodRawShape>).shape ?? {},
			annotations: { ...READ_ONLY_ANNOTATIONS, ...def.annotations },
		},
		buildHandler:
			(ctx: ToolContext) =>
			async (input: unknown): Promise<CallToolResult> => {
				try {
					const parsed = def.inputSchema.parse(input);
					const result = await def.handler(parsed, ctx);
					const text = JSON.stringify(result, jsonReplacer);
					if (text.length > MAX_RESULT_BYTES) {
						throw new ResultTooLargeError(
							`${def.name} result is ${text.length} bytes; the limit is ${MAX_RESULT_BYTES}.`,
							{ hint: "Use get_indicator_signal, which returns only the signal metadata; this indicator's per bar payload is larger than any model can use." },
						);
					}
					return {
						content: [{ type: "text", text }],
						structuredContent: result,
					};
				} catch (err) {
					const payload = toErrorPayload(err);
					return {
						isError: true,
						content: [{ type: "text", text: JSON.stringify(payload) }],
						structuredContent: { ...payload },
					};
				}
			},
	};
}

function jsonReplacer(_key: string, value: unknown): unknown {
	if (typeof value === "bigint") return value.toString();
	return value;
}
