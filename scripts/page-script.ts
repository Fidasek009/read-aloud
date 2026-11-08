/** Serialize a self-contained browser function with checked arguments for a probe driver. */
export function pageScript<Args extends unknown[]>(operation: (...args: Args) => unknown, ...args: Args): string {
	return `(${operation.toString()})(...${JSON.stringify(args)})`
}

function highlightedText() {
	return [...(CSS.highlights?.get("read-aloud-current-word") ?? [])].map((range) => range.toString()).join("")
}

/** Shared page assertion used by both browser drivers. */
export const readHighlightedText = pageScript(highlightedText)
