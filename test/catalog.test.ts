import { describe, it, expect, vi } from "vitest";
import { IndicatorCatalog, type IndicatorMeta } from "../src/catalog.js";
import { InputError } from "../src/errors.js";

const META: IndicatorMeta[] = [
	{ key: "sniperV3", displayName: "Sniper v3", description: "x", signalKind: "directional", schemaVersion: 1 },
	{ key: "momentumRadar", displayName: "Momentum Radar", description: "y", signalKind: "regime", schemaVersion: 1 },
];

function source(pages: IndicatorMeta[][]) {
	let call = 0;
	const listIndicators = vi.fn(async () => {
		const page = pages[Math.min(call, pages.length - 1)]!;
		call += 1;
		return { data: { count: page.length, indicators: page } };
	});
	return { listIndicators };
}

describe("IndicatorCatalog", () => {
	it("lists what the backend returns and caches within the TTL", async () => {
		const src = source([META]);
		const catalog = new IndicatorCatalog(src, 60_000, () => 1_000);
		expect((await catalog.list()).map((m) => m.key)).toEqual(["sniperV3", "momentumRadar"]);
		expect((await catalog.get("sniperV3"))?.displayName).toBe("Sniper v3");
		expect(src.listIndicators).toHaveBeenCalledTimes(1);
	});

	it("refetches once on a miss so a newly deployed indicator is picked up", async () => {
		const src = source([[META[0]!], META]);
		const catalog = new IndicatorCatalog(src, 60_000, () => 1_000);
		expect(await catalog.get("momentumRadar")).toBeUndefined;
		expect((await catalog.get("momentumRadar"))?.key).toBe("momentumRadar");
		expect(src.listIndicators).toHaveBeenCalledTimes(2);
	});

	it("require throws INPUT_UNKNOWN_INDICATOR naming the known keys", async () => {
		const catalog = new IndicatorCatalog(source([META]));
		await expect(catalog.require("nope")).rejects.toBeInstanceOf(InputError);
		await expect(catalog.require("nope")).rejects.toMatchObject({
			code: "INPUT_UNKNOWN_INDICATOR",
			hint: expect.stringContaining("sniperV3"),
		});
	});

	it("refreshes after the TTL elapses", async () => {
		let now = 0;
		const src = source([META]);
		const catalog = new IndicatorCatalog(src, 1_000, () => now);
		await catalog.list();
		now = 500;
		await catalog.list();
		expect(src.listIndicators).toHaveBeenCalledTimes(1);
		now = 2_000;
		await catalog.list();
		expect(src.listIndicators).toHaveBeenCalledTimes(2);
	});

	it("coalesces concurrent loads into one request", async () => {
		const src = source([META]);
		const catalog = new IndicatorCatalog(src);
		await Promise.all([catalog.list(), catalog.list(), catalog.get("sniperV3")]);
		expect(src.listIndicators).toHaveBeenCalledTimes(1);
	});
});
