/**
 * subscribe_signal — long-poll for a new signal on (indicator, symbol, resolution).
 *
 * The MCP client calls this and the server holds the connection until the
 * backend emits a signal newer than `lastSeenSignalTs` (or `timeoutMs`
 * elapses). Cheap polling under the hood — no WS, no fanout subscriber
 * registry server-side.
 *
 * Typical agent loop:
 *   1. `get_indicator_signal` → read latest, remember `signal.time`
 *   2. `subscribe_signal({ lastSeenSignalTs: that.time, timeoutMs: 25000 })`
 *      → blocks until a fresh signal appears
 *   3. React to the new signal (compose order, alert user, etc.)
 *   4. Update `lastSeenSignalTs`, loop
 */

import { z } from "zod";
import { defineTool, IndicatorKeySchema, ProviderSchema, ResolutionSchema, SymbolSchema } from "./_shared.js";

const InputSchema = z.object({
	indicator: IndicatorKeySchema,
	symbol: SymbolSchema,
	resolution: ResolutionSchema,
	lastSeenSignalTs: z.number().int().nonnegative().default(0),
	timeoutMs: z.number().int().min(1000).max(50000).default(25000),
	config: z.record(z.unknown()).optional(),
	provider: ProviderSchema.optional(),
});

export const subscribeSignal = defineTool({
	name: "subscribe_signal",
	title: "Wait for next signal",
	description:
		"Long-poll for a NEW signal on (indicator, symbol, resolution). Holds the call for up to `timeoutMs` " +
		"(1000-50000 ms) and resolves the instant a signal with `time > lastSeenSignalTs` is detected. Returns " +
		"`{signal: null, timedOut: true}` if nothing happens within the window. Pair with `get_indicator_signal` " +
		"to bootstrap `lastSeenSignalTs`. Idiomatic agent loop: get → subscribe → react → update watermark → loop.",
	inputSchema: InputSchema,
	handler: async (input, { cfg, client, catalog }) => {
		const meta = await catalog.require(input.indicator);
		const providerArg = input.provider ?? cfg.defaultProvider;
		const params: Parameters<typeof client.subscribe>[0] = {
			indicator: input.indicator,
			symbol: input.symbol,
			resolution: input.resolution,
			lastSeenSignalTs: input.lastSeenSignalTs,
			timeoutMs: input.timeoutMs,
		};
		if (input.config) params.config = input.config;
		if (providerArg !== "auto") params.provider = providerArg;
		const response = await client.subscribe(params);

		return {
			indicator: input.indicator,
			displayName: meta.displayName,
			symbol: input.symbol,
			resolution: input.resolution,
			provider: providerArg,
			watermark: input.lastSeenSignalTs,
			signal: response.data.signal,
			waitedMs: response.data.waitedMs,
			timedOut: response.data.timedOut ?? false,
		};
	},
});
