interface ModuleOptions {
	print(value: string): void
	printErr(value: string): void
	locateFile(path: string): string
	noInitialRun?: boolean
	noExitRuntime?: boolean
}
interface PhonemizerModule { callMain(arguments_: string[]): void }
export default function createPiperPhonemize(options: ModuleOptions): Promise<PhonemizerModule>
