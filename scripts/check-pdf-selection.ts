/** Run against the real MUNI text layer and the reader's selection message handler. */
export const checkPdfSelection = `(async()=>{
	const frame=document.querySelector('iframe');
	if(frame.contentWindow.location.href!==frame.src||frame.contentDocument.readyState!=='complete')
		await new Promise(resolve=>frame.addEventListener('load',resolve,{once:true}));
	const session=new URL(frame.src).hash.slice(1);
	const runtime=frame.contentWindow.browser?.runtime??frame.contentWindow.chrome.runtime;
	const tabs=frame.contentWindow.browser?.tabs??frame.contentWindow.chrome.tabs;
	const tab=await tabs.getCurrent();
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
	return {crossPageCharacters:crossPage.length,layoutHyphenation:true,compoundHighlight:true,abstractCharacters:text.length,sentenceSpacing:true,exactSelection:true,highlighted:'This',emptySelectionRejected:true,playSelection:true,domainPreserved:domain};
})()`
