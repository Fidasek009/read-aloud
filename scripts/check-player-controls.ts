/** Observe the real output graph in copied test packages without altering audio behavior. */
export async function observePlayerAudio(directory: string) {
	await Bun.write(
		`${directory}/probe-audio.js`,
		`
const NativeAudioContext=window.AudioContext;
window.__probeAudio={sources:0};
window.AudioContext=class extends NativeAudioContext {
 createGain(){const gain=super.createGain();window.__probeAudio.gain=gain;return gain;}
 createBufferSource(){window.__probeAudio.sources++;return super.createBufferSource();}
};`,
	)
	const html = Bun.file(`${directory}/player.html`)
	await Bun.write(html, (await html.text()).replace("<head>", '<head><script src="probe-audio.js"></script>'))
}

/** Run during active playback; native keyboard dismissal is checked by each browser driver. */
export const checkVolume = `(async()=>{
	const settle=async(predicate)=>{
		const deadline=performance.now()+1500;
		while(!predicate()&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));
	};
	const before=window.__probeAudio.sources;
	const previous=(await (globalThis.browser??chrome).storage.local.get('lastSpeechPerformance')).lastSpeechPerformance.recordedAt;
	const volume=document.querySelector('#volume');
	document.querySelector('#sound').click();
	await new Promise(resolve=>setTimeout(resolve,150));
	if(!document.querySelector('#volume-panel').matches(':popover-open')||document.activeElement!==volume)
		throw Error('Volume did not open and focus its native slider');
	const rect=document.querySelector('#volume-panel').getBoundingClientRect();
	if(rect.bottom>innerHeight||rect.top<40||document.querySelector('#voice').getBoundingClientRect().width>148)
		throw Error('Volume panel clipped or voice selector is too wide');
	volume.value='50';volume.dispatchEvent(new Event('input'));volume.dispatchEvent(new Event('change'));
	await settle(()=>Math.abs(window.__probeAudio.gain.gain.value-.25)<=.01);
	const gain=window.__probeAudio.gain.gain.value;
	if(Math.abs(gain-.25)>.01)throw Error('Output gain did not follow volume: '+gain);
	const storage=await (globalThis.browser??chrome).storage.local.get(['volume','lastSpeechPerformance']);
	if(storage.volume!==50||storage.lastSpeechPerformance.recordedAt!==previous||window.__probeAudio.sources!==before)
		throw Error('Volume restarted synthesis/audio or did not persist');
	volume.value='0';volume.dispatchEvent(new Event('input'));
	await settle(()=>window.__probeAudio.gain.gain.value<=.001);
	if(window.__probeAudio.gain.gain.value>.001)throw Error('Zero volume did not mute output: '+JSON.stringify({gain:window.__probeAudio.gain.gain.value,state:window.__probeAudio.gain.context.state,time:window.__probeAudio.gain.context.currentTime}));
	volume.value='75';volume.dispatchEvent(new Event('input'));volume.dispatchEvent(new Event('change'));
	return {perceptualGain:gain,muted:true,persisted:true,sourceUnchanged:true,sliderFocused:true,voiceWidth:document.querySelector('#voice').getBoundingClientRect().width};
})()`
