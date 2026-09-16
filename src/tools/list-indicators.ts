import { z } from "zod";
import { defineTool } from "./_shared.js";

export const listIndicators = defineTool({
	name: "list_indicators",
	title: "List indicators",
	description:
		"Catalog of every indicator the Sentimentracker backend can compute, read live from its registry. Returns " +
		"key, displayName, signalKind (directional / regime / levels / divergence / mixed) and a one-line " +
		"description per indicator. Call this once at session start so the agent knows which key to ask about.",
	inputSchema: z.object({}),
	handler: async (_input, { cfg, catalog }) => {
		const indicators = await catalog.list();
		return { count: indicators.length, indicators, source: cfg.endpoint };
	},
});
