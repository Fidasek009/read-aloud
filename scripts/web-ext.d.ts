// web-ext exports this module but does not ship TypeScript declarations.
// Integration tests exercise this boundary against the installed client.
declare module "web-ext/util/submit-addon" {
	export class JwtApiAuth {
		constructor(options: { apiKey: string; apiSecret: string })
		getAuthHeader(): Promise<string>
	}
	export function signAddon(options: {
		apiKey: string
		apiSecret: string
		amoBaseUrl: string
		id: string
		xpiPath: string
		downloadDir: string
		channel: "listed"
		savedUploadUuidPath: string
		metaDataJson: Record<string, unknown>
		submissionSource: string
		validationCheckTimeout: number
		approvalCheckTimeout: number
		userAgentString: string
	}): Promise<{ id: string; downloadedFiles?: string[] }>
}
