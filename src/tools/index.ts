/**
 * Tool registry. The server walks this list at boot and registers each tool
 * with the MCP client. No mode-gating here — every tool is read-only
 * (signals MCP doesn't sign / submit anything).
 */

import { listIndicators } from "./list-indicators.js";
import { getIndicatorSignal } from "./get-indicator-signal.js";
import { getIndicatorFull } from "./get-indicator-full.js";
import { getSignalConfluence } from "./get-signal-confluence.js";
import { subscribeSignal } from "./subscribe-signal.js";
import { proposeTradeFromSignal } from "./propose-trade-from-signal.js";

export function allTools() {
	return [
		listIndicators,
		getIndicatorSignal,
		getIndicatorFull,
		getSignalConfluence,
		subscribeSignal,
		proposeTradeFromSignal,
	];
}
