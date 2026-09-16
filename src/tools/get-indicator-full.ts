/**
 * Get-indicator-full — the heavyweight tool.
 *
 * Returns the FULL calculator output — every per-bar plot array
 * (ema21 / ema55 / supertrend / bandState / ...) along with the metadata
 * envelope. Payload is large (typically 100-300 KB). Use only when the
 * agent needs to reason about historical bar context, not just current
 * state.
 *
 * For "what's the signal right now?" use `get_indicator_signal` instead —
 * 50x smaller payload, same proprietary metadata.
 */

import { z } from "zod";
import { defineTool, IndicatorKeySchema, ProviderSchema, ResolutionSchema, SymbolSchema } from "./_shared.js";

const InputSchema = z.object({
	indicator: IndicatorKeySchema,
	symbol: SymbolSchema,
	resolution: ResolutionSchema,
	config: z.record(z.unknown()).optional(),
	provider: ProviderSchema.optional(),
	from: z.number().int().positive().optional(),
});

export const getIndicatorFull = defineTool({
	name: "get_indicator_full",
	title: "Get full indicator output",
	description:
		"FULL calculator output — every per-bar plot array AND the metadata envelope. Large payload (100-300 KB). " +
		"Use only when the agent needs per-bar context; otherwise prefer `get_indicator_signal`. Pass `from` " +
		"(unix seconds) to load history further back than the default window. Results over 1 MB of JSON are " +
		"refused with RESULT_TOO_LARGE.",
	inputSchema: InputSchema,
	handler: async (input, { cfg, client, catalog }) => {
		const meta = await catalog.require(input.indicator);
		const providerArg = input.provider ?? cfg.defaultProvider;
		const calcParams: Parameters<typeof client.calculate>[0] = {
			indicator: input.indicator,
			symbol: input.symbol,
			resolution: input.resolution,
			metadataOnly: false,
		};
		if (input.config) calcParams.config = input.config;
		if (input.from !== undefined) calcParams.from = input.from;
		if (providerArg !== "auto") calcParams.provider = providerArg;
		const response = await client.calculate(calcParams);

		return {
			indicator: input.indicator,
			displayName: meta.displayName,
			signalKind: meta.signalKind,
			symbol: input.symbol,
			resolution: input.resolution,
			provider: providerArg,
			cached: response.message?.includes("cached") ?? false,
			result: response.data,
		};
	},
});
