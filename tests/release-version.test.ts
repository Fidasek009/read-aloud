import { expect, test } from "bun:test"

import { parseVersion, validateRelease } from "../scripts/release-version"

test("stable versions fit both browser stores", () => {
	expect(parseVersion("1.2.3", true)).toEqual([1, 2, 3])
	expect(parseVersion("0.0.0")).toEqual([0, 0, 0])
	for (const version of ["01.2.3", "1.2", "1.2.3-beta.1", "1.2.3+build", "1.2.65536", "0.0.0", "v1.2.3", "1.2.3\n"])
		expect(() => parseVersion(version, true)).toThrow()
})

test("tags match packages and increase numerically, allowing release retries", () => {
	expect(() => validateRelease("1.10.0", "v1.10.0", ["v1.9.0", "v1.10.0", "experiment"])).not.toThrow()
	expect(() => validateRelease("0.1.0", "v0.1.0", [])).not.toThrow()
	for (const [version, tag, previous] of [
		["1.2.3", "v1.2.4", "v1.2.2"],
		["1.2.3", "v1.2.3", "v2.0.0"],
		["1.2.3", "v1.2.3", "v1.3.0"],
		["1.2.3", "v1.2.3", "v1.2.4"],
	] as const)
		expect(() => validateRelease(version, tag, [previous])).toThrow()
})
