import { expect, test } from "bun:test"

import { buildVersion, parseVersion, validateRelease, versionFromTag } from "../scripts/release-version"

test("stable versions fit both browser stores", () => {
	expect(parseVersion("1.2.3", true)).toEqual([1, 2, 3])
	for (const version of ["01.2.3", "1.2", "1.2.3-beta.1", "1.2.3+build", "1.2.65536", "0.0.0", "v1.2.3", "1.2.3\n"])
		expect(() => parseVersion(version, true)).toThrow()
})
test("tag is the release version even when package metadata disagrees", () => {
	expect(buildVersion({ GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v2.3.4", npm_package_version: "0.0.0" })).toBe(
		"2.3.4",
	)
	expect(buildVersion({ npm_package_version: "99.0.0" })).toBe("0.0.0")
	expect(buildVersion({ RELEASE_VERSION: "2.3.4" })).toBe("2.3.4")
	expect(() => buildVersion({ GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v2.3.4", RELEASE_VERSION: "1.0.0" })).toThrow()
	for (const tag of ["2.3.4", "v0.0.0", "v2.3.4-rc.1", "v02.3.4", "v2.3.4\n"])
		expect(() => versionFromTag(tag)).toThrow()
})
test("tags increase numerically, allowing release retries", () => {
	expect(validateRelease("v1.10.0", ["v1.9.0", "v1.10.0", "experiment"])).toBe("1.10.0")
	expect(validateRelease("v0.1.0", [])).toBe("0.1.0")
	for (const previous of ["v2.0.0", "v1.3.0", "v1.2.4"]) expect(() => validateRelease("v1.2.3", [previous])).toThrow()
})
