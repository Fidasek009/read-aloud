import { versionFromTag } from "./release-version"

// Recovery tooling comes from main; packages and listing materials come from the
// immutable tag and its original CI run. Never substitute a fresh build.
export async function checkReleaseRecovery(tag: string, runId: string) {
	versionFromTag(tag)
	if (!/^[1-9]\d*$/.test(runId)) throw new Error("Expected the original release run ID")
	const repository = process.env.GITHUB_REPOSITORY
	if (!repository) throw new Error("GITHUB_REPOSITORY is required")
	const run = await Bun.$`gh api ${`repos/${repository}/actions/runs/${runId}`}`.quiet().json()
	const commit = (await Bun.$`git rev-parse ${`${tag}^{commit}`}`.quiet().text()).trim()
	if (
		run.event !== "push" ||
		run.path !== ".github/workflows/release.yml" ||
		run.head_branch !== tag ||
		run.head_sha !== commit ||
		run.head_repository?.full_name !== repository ||
		run.status !== "completed"
	)
		throw new Error("Recovery requires the completed original release run for this exact tag commit")
	const { jobs } = await Bun.$`gh api ${`repos/${repository}/actions/runs/${runId}/jobs?per_page=100`}`.quiet().json()
	for (const name of [
		"Validate release",
		"ci / Checks",
		"ci / Package (chrome)",
		"ci / Package (firefox)",
		"ci / Store assets",
		"ci / CI complete",
		"cd / preflight",
	])
		if (!jobs.some((job: { name: string; conclusion: string }) => job.name === name && job.conclusion === "success"))
			throw new Error(`Original release did not pass ${name}`)
	console.log(`Verified original CI and release tag ${tag} at ${commit}; recovering run ${runId}.`)
}

if (import.meta.main) await checkReleaseRecovery(process.env.RELEASE_TAG ?? "", process.env.RELEASE_RUN_ID ?? "")
