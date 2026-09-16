/**
 * MCP server factory. Builds an `McpServer` pre-loaded with every signals
 * tool. Split from `index.ts` so tests can spin up an in-memory server.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IndicatorCatalog } from "./catalog.js";
import { SignalsClient } from "./client.js";
import type { Config } from "./config.js";
import type { ToolContext } from "./tools/_shared.js";
import { allTools } from "./tools/index.js";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";

export { SERVER_NAME, SERVER_VERSION } from "./version.js";

/** Handed to the client in the initialize handshake; how to use this server well. */
const INSTRUCTIONS =
	"Sentimentracker signals: proprietary trading indicators for crypto and stock symbols. " +
	"Call list_indicators once to learn the indicator keys, then get_indicator_signal for the latest signal of " +
	"one indicator, get_signal_confluence to compare several, subscribe_signal to wait for the next signal, and " +
	"get_indicator_full only when per bar series are needed. Crypto symbols on Binance are written " +
	"Binance:BTC/USDT; Hyperliquid coins are bare (BTC) with provider=hyperliquid; stocks are bare tickers. " +
	"Every tool is read only. propose_trade_from_signal only composes an order payload for the Hyperliquid MCP " +
	"and never places an order.";

export function buildServer(cfg: Config, clientOverride?: SignalsClient): McpServer {
	const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
	const client = clientOverride ?? new SignalsClient(cfg);
	const ctx: ToolContext = { cfg, client, catalog: new IndicatorCatalog(client) };

	for (const tool of allTools()) {
		server.registerTool(tool.name, tool.definition, tool.buildHandler(ctx));
	}

	return server;
}
