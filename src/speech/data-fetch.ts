// Spellophone expects manifest.json, but store packages must contain only the
// extension's root manifest. Use its supported fetch hook to address our renamed
// data inventory without patching upstream code or changing any speech data.
export function speechDataFetch(directory: URL, fetchImpl: typeof fetch = fetch): typeof fetch {
	const inventory = new URL("manifest.json", directory).href
	const packagedInventory = new URL("data-index.json", directory)
	return new Proxy(fetchImpl, {
		apply(target, receiver, args: Parameters<typeof fetch>) {
			const [input, init] = args
			const url = input instanceof Request ? input.url : String(input)
			if (url !== inventory) return Reflect.apply(target, receiver, args)
			const renamed = input instanceof Request ? new Request(packagedInventory, input) : packagedInventory
			return Reflect.apply(target, receiver, [renamed, init])
		},
	})
}
