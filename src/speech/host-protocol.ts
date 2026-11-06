import { browser } from "wxt/browser"

import { MAX_VOICE_ID_LENGTH } from "./protocol.ts"

export const SPEECH_CLIENT_PORT = "speech-client"
export const SPEECH_SERVER_PORT = "speech-server"
export const SPEECH_GPU_FAILURE_KEY = "speechGpuFailed"

export type SpeechHostCommand =
	| { type: "installed-voices" }
	| { type: "prepare-speech-host" }
	| { type: "reserve-speech-host" }
	| { type: "claim-speech-host-close" }
	| { type: "release-speech-host-close" }
	| { type: "close-idle-speech-host" }
	| { type: "connect-speech-host" }
	| { type: "speech-voice-deleted"; id: string }
	| { type: "speech-gpu-available" }
	| { type: "speech-gpu-failed" }

export type SpeechHostReply = { ok: boolean }
export type SpeechHostResponse<C extends SpeechHostCommand> = C extends { type: "installed-voices" }
	? string[]
	: SpeechHostReply

type SpeechHostHandlers = {
	[Tag in SpeechHostCommand["type"]]?: (
		command: Extract<SpeechHostCommand, { type: Tag }>,
	) =>
		| SpeechHostResponse<Extract<SpeechHostCommand, { type: Tag }>>
		| Promise<SpeechHostResponse<Extract<SpeechHostCommand, { type: Tag }>>>
}

/** A typed registry prevents sender/receiver tag drift and validates before dispatch. */
export function speechHostDispatcher(handlers: SpeechHostHandlers) {
	return (command: unknown): Promise<unknown> | undefined => {
		if (
			!command ||
			typeof command !== "object" ||
			!("type" in command) ||
			typeof command.type !== "string" ||
			!Object.hasOwn(handlers, command.type)
		)
			return
		if (!isSpeechHostCommand(command)) return Promise.reject(new Error("Invalid speech host command"))
		const handler = handlers[command.type] as (command: SpeechHostCommand) => unknown
		return Promise.resolve(handler(command))
	}
}

const commandTypes: Record<SpeechHostCommand["type"], true> = {
	"installed-voices": true,
	"prepare-speech-host": true,
	"reserve-speech-host": true,
	"claim-speech-host-close": true,
	"release-speech-host-close": true,
	"close-idle-speech-host": true,
	"connect-speech-host": true,
	"speech-voice-deleted": true,
	"speech-gpu-available": true,
	"speech-gpu-failed": true,
}

export function isSpeechHostCommand(message: unknown): message is SpeechHostCommand {
	if (
		!message ||
		typeof message !== "object" ||
		!("type" in message) ||
		typeof message.type !== "string" ||
		!Object.hasOwn(commandTypes, message.type)
	)
		return false
	return (
		message.type !== "speech-voice-deleted" ||
		("id" in message && typeof message.id === "string" && !!message.id && message.id.length <= MAX_VOICE_ID_LENGTH)
	)
}

export function isSpeechHostReply(response: unknown): response is SpeechHostReply {
	return !!response && typeof response === "object" && "ok" in response && typeof response.ok === "boolean"
}

/** Outgoing commands and their replies share the same contract in all hosts. */
export async function sendSpeechHost<C extends SpeechHostCommand>(command: C): Promise<SpeechHostResponse<C>> {
	const response: unknown = await browser.runtime.sendMessage(command)
	const valid =
		command.type === "installed-voices"
			? Array.isArray(response) &&
				response.every((id: unknown) => typeof id === "string" && id.length <= MAX_VOICE_ID_LENGTH)
			: isSpeechHostReply(response)
	if (!valid) throw new Error(`Invalid speech host reply to ${command.type}`)
	return response as SpeechHostResponse<C>
}
