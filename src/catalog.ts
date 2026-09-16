/**
 * Indicator catalog, read live from the backend.
 *
 * The backend registry (`GET /superchart/indicators`) is the only list of
 * indicators; this MCP ships none of its own. Entries are cached for
 * `ttlMs` and refreshed once on a miss, so a newly deployed indicator is
 * usable without restarting the server and a typo does not hammer the
 * backend.
 */

import type { SignalsClient } from "./client.js";
import { InputError } from "./errors.js";

export type IndicatorSignalKind = "directional" | "regime" | "levels" | "divergence" | "mixed";

/** Mirrors the backend registry's `IndicatorMeta`. */
export interface IndicatorMeta {
	/** Backend calculator key — the `indicator` body field. camelCase, e.g. "sniperV3". */
	key: string;
	displayName: string;
	description: string;
	signalKind: IndicatorSignalKind;
	schemaVersion: number;
	defaultPollIntervalMs?: number;
}

const DEFAULT_TTL_MS = 5 * 60_000;

type CatalogSource = Pick<SignalsClient, "listIndicators">;

export class IndicatorCatalog {
	private entries: ReadonlyMap<string, IndicatorMeta> | null = null;
	private fetchedAt = 0;
	private inflight: Promise<ReadonlyMap<string, IndicatorMeta>> | null = null;

	constructor(
		private readonly source: CatalogSource,
		private readonly ttlMs: number = DEFAULT_TTL_MS,
		private readonly now: () => number = Date.now,
	) {}

	async list(): Promise<IndicatorMeta[]> {
		return Array.from((await this.load()).values());
	}

	/** Metadata for `key`, refreshing the cache once if the key is unknown. */
	async get(key: string): Promise<IndicatorMeta | undefined> {
		const cached = (await this.load()).get(key);
		if (cached) return cached;
		return (await this.load(true)).get(key);
	}

	/** `get`, but an unknown key is an input error that names the valid keys. */
	async require(key: string): Promise<IndicatorMeta> {
		const meta = await this.get(key);
		if (meta) return meta;
		const known = Array.from((await this.load()).keys());
		throw new InputError(
			"INPUT_UNKNOWN_INDICATOR",
			`Unknown indicator key: ${key}`,
			`Known keys: ${known.join(", ")}. Call list_indicators for details.`,
		);
	}

	private async load(force = false): Promise<ReadonlyMap<string, IndicatorMeta>> {
		const fresh = this.entries !== null && this.now() - this.fetchedAt < this.ttlMs;
		if (this.entries && fresh && !force) return this.entries;
		if (!this.inflight) {
			this.inflight = this.source
				.listIndicators()
				.then((res) => {
					const map = new Map(res.data.indicators.map((m) => [m.key, m]));
					this.entries = map;
					this.fetchedAt = this.now();
					return map;
				})
				.finally(() => {
					this.inflight = null;
				});
		}
		return this.inflight;
	}
}
