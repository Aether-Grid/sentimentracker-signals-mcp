import { describe, it, expect } from "vitest";
import { AuthError, BackendError, InputError, InternalError, toErrorPayload } from "../src/errors.js";

describe("error envelope normalization", () => {
	it("AuthError preserves code + hint", () => {
		const p = toErrorPayload(new AuthError("AUTH_EXPIRED", "session gone", "refresh it"));
		expect(p.code).toBe("AUTH_EXPIRED");
		expect(p.hint).toBe("refresh it");
	});

	it("BackendError preserves status", () => {
		const p = toErrorPayload(new BackendError("BACKEND_HTTP_ERROR", "boom", { status: 502 }));
		expect(p.code).toBe("BACKEND_HTTP_ERROR");
		expect(p.status).toBe(502);
	});

	it("InputError surfaces INPUT_* code", () => {
		expect(toErrorPayload(new InputError("INPUT_UNKNOWN_INDICATOR", "nope")).code).toBe("INPUT_UNKNOWN_INDICATOR");
	});

	it("InternalError default", () => {
		expect(toErrorPayload(new InternalError("oops")).code).toBe("INTERNAL_ERROR");
	});

	it("unknown Error → INTERNAL_ERROR", () => {
		expect(toErrorPayload(new Error("misc")).code).toBe("INTERNAL_ERROR");
	});

	it("non-Error → INTERNAL_ERROR", () => {
		expect(toErrorPayload({ weird: true }).code).toBe("INTERNAL_ERROR");
		expect(toErrorPayload("string thrown").code).toBe("INTERNAL_ERROR");
	});
});
