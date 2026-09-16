import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SERVER_NAME, SERVER_VERSION } from "../src/version.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
	name: string;
	version: string;
	bin: Record<string, string>;
};

describe("version", () => {
	it("matches package.json so the MCP handshake and npm agree", () => {
		expect(SERVER_VERSION).toBe(pkg.version);
	});
	it("bin name is the server name", () => {
		expect(Object.keys(pkg.bin)).toEqual([SERVER_NAME]);
	});
});
