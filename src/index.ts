#!/usr/bin/env node
/**
 * stdio entrypoint.
 *
 * Run:
 *   SNT_SIGNALS_API_KEY=snt_mcp_… node dist/index.js
 *
 * Wire into Claude Desktop / Cursor / Cline (`mcpServers` block):
 *   {
 *     "command": "node",
 *     "args": ["/path/to/sentimentracker-signals-mcp/dist/index.js"],
 *     "env": {
 *       "SNT_SIGNALS_API_KEY": "snt_mcp_…",
 *       "SNT_SIGNALS_DEFAULT_PROVIDER": "hyperliquid"
 *     }
 *   }
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, assertAuthIsRunnable } from "./config.js";
import { buildServer } from "./server.js";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";

async function main(): Promise<void> {
	const cfg = loadConfig();
	assertAuthIsRunnable(cfg);

	const server = buildServer(cfg);
	const transport = new StdioServerTransport();
	await server.connect(transport);

	process.stderr.write(
		`[${SERVER_NAME}@${SERVER_VERSION}] endpoint=${cfg.endpoint} provider=${cfg.defaultProvider}` +
			` auth=${cfg.sessionToken ? "session" : "apikey"}\n`,
	);
}

main().catch((err) => {
	process.stderr.write(`[${SERVER_NAME}] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
	process.exit(1);
});
