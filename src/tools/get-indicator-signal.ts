/**
 * Get-indicator-signal — the bread-and-butter tool.
 *
 * Returns ONLY the latest emitted signal (BUY/SELL pill, divergence print,
 * BOS/CHoCH event, …) plus the currently-active trade context — without the
 * 200KB of plot arrays. Backed by `metadataOnly=true` on the calculate route
 * so payload is ~5KB instead of 200KB.
 *
 * Use this when the LLM needs to answer "what is <indicator> saying about
 * <coin> right now?". For full per-bar series (charts, drawer plots) use
 * `get_indicator_full` with `metadataOnly=false`.
 */

import { z } from "zod";
import { defineTool, IndicatorKeySchema, ProviderSchema, ResolutionSchema, SymbolSchema } from "./_shared.js";

const InputSchema = z.object({
	indicator: IndicatorKeySchema,
	symbol: SymbolSchema,
	resolution: ResolutionSchema,
	config: z.record(z.unknown()).optional(),
	provider: ProviderSchema.optional(),
});

export const getIndicatorSignal = defineTool({
	name: "get_indicator_signal",
	title: "Get latest signal",
	description:
		"Latest signal envelope for the given (indicator, symbol, resolution). Returns the proprietary metadata " +
		"only — signals[], trades[], currentTrade — without the full per-bar plot arrays. Use this for 'what is " +
		"sniperV3 saying about BTC on 15m right now?'. Optional `config` overrides the indicator's default params; " +
		"`provider` forces a bar provider (auto / hyperliquid / binance / tiingo / intrinio / databento).",
	inputSchema: InputSchema,
	handler: async (input, { cfg, client, catalog }) => {
		const meta = await catalog.require(input.indicator);
		const providerArg = input.provider ?? cfg.defaultProvider;
		const calcParams: Parameters<typeof client.calculate>[0] = {
			indicator: input.indicator,
			symbol: input.symbol,
			resolution: input.resolution,
			metadataOnly: true,
		};
		if (input.config) calcParams.config = input.config;
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
			metadata: response.data.metadata ?? response.data,
		};
	},
});
