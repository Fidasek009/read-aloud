/** Use the browser's media-key routing, including when the source tab is inactive. */
export function bindMediaSession(
	session: MediaSession | undefined,
	actions: Pick<Record<MediaSessionAction, () => void>, "play" | "pause" | "previoustrack" | "nexttrack" | "stop">,
) {
	if (session && typeof MediaMetadata !== "undefined") session.metadata = new MediaMetadata({ title: "Read Aloud" })
	const registered: MediaSessionAction[] = []
	for (const action of Object.keys(actions) as (keyof typeof actions)[]) {
		try {
			session?.setActionHandler(action, actions[action])
			registered.push(action)
		} catch (error) {
			// Browsers may expose Media Session without supporting every action.
			if (!(error instanceof DOMException) || error.name !== "NotSupportedError") throw error
		}
	}
	return {
		update(state: MediaSessionPlaybackState) {
			if (session) session.playbackState = state
		},
		dispose() {
			if (!session) return
			for (const action of registered) session.setActionHandler(action, null)
			registered.length = 0
			session.playbackState = "none"
			session.metadata = null
		},
	}
}
