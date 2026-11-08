import type { browser } from "wxt/browser"

import { playbackCopy } from "../src/playback/copy.ts"
import { failNextPlayback } from "./check-player-controls.ts"
import { pageScript } from "./page-script.ts"
import { assert, waitFor } from "./probe-helpers.ts"

export interface RecoveryDriver {
	player<T>(expression: string): Promise<T>
	source<T>(expression: string): Promise<T>
	pressPlay(): Promise<void>
	readSelectionFromMenu(): Promise<void>
}
export interface SelectionScope {
	text: string
	session: string
}

// These browser functions are self-contained so their assertions are typechecked
// here and serialized unchanged for either driver.
function playerState() {
	const play = document.querySelector<HTMLButtonElement>("#play")
	const next = document.querySelector<HTMLButtonElement>("#next")
	const status = document.querySelector<HTMLElement>("#status")
	if (!play || !next || !status) throw new Error("Playback controls are missing")
	return {
		status: status.textContent,
		canRetry: !play.disabled,
		playLabel: play.getAttribute("aria-label"),
		nextDisabled: next.disabled,
		session: location.hash,
	}
}

async function currentScope() {
	const fixture = window as Window & typeof globalThis & { browser?: typeof browser; chrome?: typeof browser }
	const extension = fixture.browser ?? fixture.chrome
	if (!extension) throw new Error("Extension runtime is unavailable")
	const response: unknown = await extension.runtime.sendMessage({
		type: "reader",
		session: location.hash.slice(1),
		command: "document",
	})
	if (!response || typeof response !== "object" || !("text" in response) || typeof response.text !== "string")
		throw new Error("Reader did not return its current scope")
	return response.text
}

function selectSource(selector: string) {
	const element = document.querySelector(selector)
	const selection = window.getSelection()
	if (!element || !selection) throw new Error("Source selection fixture is unavailable")
	selection.selectAllChildren(element)
	const text = selection.toString()
	if (!text.trim()) throw new Error("Source selection fixture is empty")
	return text
}

const readState = (driver: RecoveryDriver) => driver.player<ReturnType<typeof playerState>>(pageScript(playerState))
const readScope = (driver: RecoveryDriver) => driver.player<string>(pageScript(currentScope))

async function failAndCheckRetry(driver: RecoveryDriver) {
	await driver.player(failNextPlayback)
	const failed = await waitFor(
		() => readState(driver),
		(state) => state.status === playbackCopy.failed,
	)
	assert(failed.canRetry, "Playback failure disabled Play instead of offering recovery")
}

async function assertScope(driver: RecoveryDriver, scope: SelectionScope) {
	await waitFor(
		() => readScope(driver),
		(text) => text === scope.text,
	)
	assert((await readState(driver)).session === scope.session, "Selection recovery replaced the existing reader")
}

/** A new selection replaces the failed scope when trusted Play is activated. */
export async function recoverSelectionAfterFailure(
	driver: RecoveryDriver,
	selector: string,
	afterFailure?: () => Promise<void>,
): Promise<SelectionScope> {
	const session = (await readState(driver)).session
	await failAndCheckRetry(driver)
	await afterFailure?.()
	const text = await driver.source<string>(pageScript(selectSource, selector))
	await driver.pressPlay()
	const scope = { text, session }
	await assertScope(driver, scope)
	return scope
}

/** Completion and replay must remain inside the explicitly selected scope. */
export async function verifySelectionReplay(driver: RecoveryDriver, scope: SelectionScope) {
	const ended = await waitFor(
		() => readState(driver),
		(state) => state.status === "Finished",
	)
	assert(ended.nextDisabled, "Selection continued beyond its final sentence")
	await driver.pressPlay()
	await waitFor(
		() => readState(driver),
		(state) => state.playLabel === "Pause",
	)
	await assertScope(driver, scope)
}

/** The installed context-menu handler must also recover the same failed reader. */
export async function recoverSelectionFromMenu(driver: RecoveryDriver, selector: string) {
	const session = (await readState(driver)).session
	await failAndCheckRetry(driver)
	const text = await driver.source<string>(pageScript(selectSource, selector))
	await driver.readSelectionFromMenu()
	const recovered = await waitFor(
		() => readState(driver),
		(state) => state.status === "Reading" || state.status === "Press Play to start listening.",
	)
	if (recovered.status === "Press Play to start listening.") await driver.pressPlay()
	await waitFor(
		() => readState(driver),
		(state) => state.playLabel === "Pause",
	)
	await assertScope(driver, { text, session })
}
