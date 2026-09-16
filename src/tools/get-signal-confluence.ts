/**
 * Multi-indicator confluence — the "what do all my indicators agree on?" tool.
 *
 * Fan-fetches `metadataOnly=true` for N indicators in parallel against the
 * same (symbol, resolution) and returns a deduped table the LLM can use to
 * judge confluence. Each row reports the most recent signal's side + ts;
 * the LLM gets to decide what "agreement" means (e.g. ≥3 BUY in last hour).
 *
 * Hits the backend cache for any indicator already computed in the last bar,
 * so fan-out cost on a hot symbol is one HTTP per indicator (memory hits) +
 * one full compute per cold indicator.
 */

import { z } from "zod";
import { defineTool, IndicatorKeySchema, ProviderSchema, ResolutionSchema, SymbolSchema } from "./_shared.js";

const InputSchema = z.object({
	indicators: z.array(IndicatorKeySchema).min(1).max(20),
	symbol: SymbolSchema,
	resolution: ResolutionSchema,
	provider: ProviderSchema.optional(),
});

export const getSignalConfluence = defineTool({
	name: "get_signal_confluence",
	title: "Multi indicator confluence",
	description:
		"Run N indicators in parallel against the same (symbol, resolution) and return a compact confluence " +
		"table. Each row: indicator key, displayName, signalKind, latest signal side (BUY/SELL/null), latest " +
		"signal ts (ms), error (if any). The LLM judges agreement from the table — there's no built-in voting " +
		"rule. Max 20 indicators per call; unknown keys fail the whole call before any fetch.",
	inputSchema: InputSchema,
	handler: async (input, { cfg, client, catalog }) => {
		const providerArg = input.provider ?? cfg.defaultProvider;
		const metas = await Promise.all(input.indicators.map((key) => catalog.require(key)));
		const rows = await Promise.all(
			metas.map(async (meta) => {
				const key = meta.key;
				try {
					const calcParams: Parameters<typeof client.calculate>[0] = {
						indicator: key,
						symbol: input.symbol,
						resolution: input.resolution,
						metadataOnly: true,
					};
					if (providerArg !== "auto") calcParams.provider = providerArg;
					const response = await client.calculate(calcParams);
					const md = (response.data.metadata ?? response.data) as Record<string, unknown>;
					const latest = extractLatestSignal(md);
					return {
						indicator: key,
						displayName: meta.displayName,
						signalKind: meta.signalKind,
						latestSide: latest?.side ?? null,
						latestTs: latest?.ts ?? null,
						error: null,
					};
				} catch (err) {
					return {
						indicator: key,
						displayName: meta.displayName,
						signalKind: meta.signalKind,
						latestSide: null,
						latestTs: null,
						error: err instanceof Error ? err.message : String(err),
					};
				}
			}),
		);

		return {
			symbol: input.symbol,
			resolution: input.resolution,
			provider: providerArg,
			count: rows.length,
			rows,
		};
	},
});

/**
 * Best-effort latest-signal extraction. Different indicators have slightly
 * different metadata shapes; this digs for the common patterns:
 *   - `signals: [{ type: "BUY"|"SELL", time }, ...]`  (most common)
 *   - `currentTrade: { side: "BUY"|"SELL" }`         (mup / sniperV3)
 *   - `bias: "bullish"|"bearish"`                     (regime indicators)
 *
 * Returns null if no extractable signal shape is found. The LLM can still
 * read the full metadata via `get_indicator_signal` to interpret.
 */
function extractLatestSignal(md: Record<string, unknown>): { side: "BUY" | "SELL"; ts: number | null } | null {
	const signals = md.signals;
	if (Array.isArray(signals) && signals.length > 0) {
		const last = signals[signals.length - 1] as Record<string, unknown> | undefined;
		if (last) {
			const type = (last.type ?? last.side) as string | undefined;
			const ts = (last.time ?? last.ts ?? last.timestamp) as number | undefined;
			if (type === "BUY" || type === "SELL") return { side: type, ts: typeof ts === "number" ? ts : null };
		}
	}
	const current = md.currentTrade;
	if (current && typeof current === "object" && current !== null) {
		const side = (current as { side?: unknown }).side as string | undefined;
		if (side === "BUY" || side === "SELL") return { side, ts: null };
	}
	const bias = md.bias;
	if (bias === "bullish") return { side: "BUY", ts: null };
	if (bias === "bearish") return { side: "SELL", ts: null };
	return null;
}
