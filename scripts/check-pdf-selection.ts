/** Run against the real MUNI text layer and the reader's selection message handler. */
export const checkPdfSelection = `(async()=>{
	const frame=document.querySelector('iframe');
	if(frame.contentWindow.location.href!==frame.src||frame.contentDocument.readyState!=='complete')
		await new Promise(resolve=>frame.addEventListener('load',resolve,{once:true}));
	let session=new URL(frame.src).hash.slice(1);
	const runtime=frame.contentWindow.browser?.runtime??frame.contentWindow.chrome.runtime;
	const tabs=frame.contentWindow.browser?.tabs??frame.contentWindow.chrome.tabs;
	// Keep only parent-owned data: Firefox invalidates objects from a closed iframe.
	const tab={id:(await tabs.getCurrent()).id};
	const read=async(mode)=>{
		const result=await runtime.sendMessage({type:'pdf-read',tabId:tab.id,mode});
		if(result?.error)throw Error(result.error);
	};
	const documentText=async()=> (await window.readAloudHost({session,command:'document'})).text;
	const full=await documentText();
	const abstract=full.indexOf('Abstract');
	const start=full.indexOf('Molecular dynamics (MD)',abstract);
	const ending='open-source project.';
	const end=full.indexOf(ending,start)+ending.length;
	if(abstract<0||start<abstract||end<start)throw Error('Abstract fixture not found');
	// Select real lazy-rendered text before any highlight can repair its mappings.
	const abstractPage=document.querySelector('.pdf-page:nth-child(6)');
	abstractPage.scrollIntoView();
	let first,last;
	const lazyDeadline=performance.now()+10000;
	do {
		const walker=document.createTreeWalker(abstractPage.querySelector('.textLayer'),NodeFilter.SHOW_TEXT);
		for(let node=walker.nextNode();node;node=walker.nextNode()){
			if(node.data.includes('Their day-to-day'))first=node;
			if(node.data.includes('disconnection of analysis'))last=node;
		}
		if(first&&last)break;
		await new Promise(resolve=>setTimeout(resolve,25));
	}while(performance.now()<lazyDeadline);
	if(!first||!last)throw Error('Visible abstract text layer did not render');
	const freshRange=document.createRange();
	freshRange.setStart(first,first.data.indexOf('Their day-to-day'));
	freshRange.setEnd(last,last.data.indexOf('workflow.')+'workflow.'.length);
	const expectedFresh=full.slice(full.indexOf('Their day-to-day',start),full.indexOf('workflow.',start)+'workflow.'.length);
	getSelection().removeAllRanges();getSelection().addRange(freshRange);
	const fresh=await window.readAloudHost({session,command:'selection'});
	if(fresh.text!==expectedFresh)throw Error('A fresh DOM selection failed without a preceding highlight: '+JSON.stringify(fresh));
	await read('article');
	getSelection().addRange(freshRange);
	document.dispatchEvent(new Event('selectionchange'));
	getSelection().removeAllRanges();
	const afterFocus=await window.readAloudHost({session,command:'selection'});
	if(afterFocus.text!==expectedFresh)throw Error('Play lost selection when focus moved to controls');
	await read('article');
	document.querySelector('#pages').dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true}));
	if((await window.readAloudHost({session,command:'selection'})).text!==null)throw Error('Consumed selection was reused');
	const select=async(from,to,fromPlay=false)=>{
		await read('article');
		await window.readAloudHost({session,command:'highlight',start:from,end:to});
		const marked=CSS.highlights.get('read-aloud-current-word');
		if(!marked)throw Error('PDF range could not be highlighted: '+JSON.stringify({from,to,first:full.slice(from,from+30),last:full.slice(to-30,to)}));
		const range=[...marked][0].cloneRange();
		getSelection().removeAllRanges();getSelection().addRange(range);
		if(fromPlay)await window.readAloudHost({session,command:'selection'});
		else await read('selection');
		const actual=await documentText();
		if(actual!==full.slice(from,to))throw Error('PDF selection lost text or layout separators');
		return actual;
	};
	const text=await select(start,end);
	const expectedSentence='Their day-to-day use is nevertheless constrained by four limitations: the absence of systematic performance tuning, the command-line nature of the dominant simulation engines, the lack of standardized data stewardship, and the disconnection of analysis from the rest of the workflow.';
	if(!text.includes(expectedSentence))throw Error('The reported abstract sentence is still hyphenated incorrectly');
	for(const word of ['nevertheless','simulation']){
		const from=full.indexOf(word,full.indexOf('Their day-to-day',start));
		await read('article');
		await window.readAloudHost({session,command:'highlight',start:from,end:from+word.length});
		const range=[...CSS.highlights.get('read-aloud-current-word')][0];
		if(range.getClientRects().length<2||range.toString().replace(/[-\\s]/gu,'')!==word)throw Error('Reported split word does not map across both lines: '+word);
	}
	await select(start,end);
	if(!text.includes('workflow. This thesis')||!text.includes('metadata. The platform'))
		throw Error('PDF sentence boundaries collapsed into dotted words');
	const word=text.indexOf('This thesis');
	await window.readAloudHost({session,command:'highlight',start:word,end:word+4});
	if([...CSS.highlights.get('read-aloud-current-word')][0].toString()!=='This')
		throw Error('Highlight shifted after preserving PDF whitespace');
	const boundary=full.indexOf('workflow. This thesis',start)+4;
	const partial=await select(boundary,boundary+'flow. This the'.length,true);
	if(partial!=='flow. This the')throw Error('Selection extended past its exact boundaries');
	const selection=getSelection();const caret=document.createRange();
	const layer=document.querySelector('.pdf-page:nth-child(6) .textLayer');
	caret.selectNodeContents(layer);caret.collapse(true);selection.removeAllRanges();selection.addRange(caret);
	const rejected=await runtime.sendMessage({type:'pdf-read',tabId:tab.id,mode:'selection'});
	if(!rejected?.error||await documentText()!==partial)throw Error('Empty PDF selection started reading');
	const empty=await window.readAloudHost({session,command:'selection'});
	if(empty.text!==null||await documentText()!==partial)throw Error('Play without a selection replaced the reading scope');
	selection.removeAllRanges();
	const domain='Consensus.app',domainStart=full.indexOf(domain);
	if(domainStart<0)throw Error('Domain fixture not found');
	if(await select(domainStart,domainStart+domain.length,true)!==domain)
		throw Error('PDF selection changed a genuine domain dot');
	const acknowledgements=full.indexOf('Acknowledgements');
	const crossStart=full.indexOf('This work was supported',acknowledgements);
	const crossEnd=full.slice(0,full.indexOf('This thesis',crossStart)).trimEnd().length;
	if(crossStart<0||crossEnd<crossStart)throw Error('Cross-page fixture not found');
	const crossPage=await select(crossStart,crossEnd,true);
	if(!crossPage.includes('Abstract')||!crossPage.includes('iv'))throw Error('Cross-page selection lost a page boundary');
	await read('article');
	const joined=full.indexOf('infrastructure',acknowledgements);
	if(joined<0)throw Error('PDF line-end hyphenation was not joined');
	await window.readAloudHost({session,command:'highlight',start:joined,end:joined+'infrastructure'.length});
	const joinedRange=[...CSS.highlights.get('read-aloud-current-word')][0];
	if(joinedRange.toString().replace(/[-\\s]/gu,'')!=='infrastructure'||joinedRange.getClientRects().length<2)
		throw Error('Joined PDF word no longer highlights both printed fragments');
	const compoundText=full.match(/pre-exascale/iu)?.[0]??'';
	const compound=compoundText?full.indexOf(compoundText):-1;
	if(compound<0)throw Error('Genuine compound hyphen was removed');
	await window.readAloudHost({session,command:'highlight',start:compound,end:compound+'pre-exascale'.length});
	if([...CSS.highlights.get('read-aloud-current-word')][0].toString()!==compoundText)
		throw Error('Full compound highlight was lost');
	await read('article');
	await window.readAloudHost({session,command:'highlight',start,end});
	const restartRange=[...CSS.highlights.get('read-aloud-current-word')][0].cloneRange();
	await window.readAloudHost({session,command:'close'});
	if(document.querySelector('iframe'))throw Error('PDF player did not close');
	getSelection().removeAllRanges();getSelection().addRange(restartRange);
	document.querySelector('#pages').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2}));
	getSelection().removeAllRanges();
	const restart=await (globalThis.browser??chrome).runtime.sendMessage({type:'probe-context-menu',omitTabUrl:true,tab,info:{menuItemId:'read-selection',pageUrl:location.href,selectionText:restartRange.toString()}});
	const deadline=performance.now()+5000;
	while(!document.querySelector('iframe')&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));
	if(!document.querySelector('iframe'))throw Error('PDF context-menu command did not reopen the player');
	if(!restart?.omittedUrl)throw Error('PDF restart test did not exercise missing Tab.url');
	const oldSession=session;
	session=new URL(document.querySelector('iframe').src).hash.slice(1);
	if(session===oldSession)throw Error('PDF restart reused a closed session');
	let rejectedSession=false;
	try{await window.readAloudHost({session:oldSession,command:'close'});}catch{rejectedSession=true;}
	if(!rejectedSession||!document.querySelector('iframe'))throw Error('Closed PDF session still controls the new player');
	if(await documentText()!==full.slice(start,end))throw Error('PDF restart lost its exact selection');
	await (globalThis.browser??chrome).runtime.sendMessage({type:'probe-context-menu',tab,info:{menuItemId:'read-page',pageUrl:location.href}});
	const restoreDeadline=performance.now()+5000;
	while(await documentText()!==full&&performance.now()<restoreDeadline)await new Promise(resolve=>setTimeout(resolve,25));
	if(await documentText()!==full)throw Error('PDF context-menu article restart failed');
	const firstPage=document.querySelector('.pdf-page');
	const pageTop=firstPage.getBoundingClientRect().top+scrollY;
	const frameHeight=document.querySelector('iframe').getBoundingClientRect().height;
	await window.readAloudHost({session,command:'resize',height:160});
	if(Math.abs(firstPage.getBoundingClientRect().top+scrollY-pageTop)>1)throw Error('Floating PDF controls shifted the document');
	await window.readAloudHost({session,command:'resize',height:frameHeight});
	return {contextMenuRestart:true,closedSessionRejected:true,floatingControlsDoNotShiftPages:true,crossPageCharacters:crossPage.length,layoutHyphenation:true,compoundHighlight:true,abstractCharacters:text.length,sentenceSpacing:true,exactSelection:true,highlighted:'This',emptySelectionRejected:true,playSelection:true,domainPreserved:domain};
})()`
