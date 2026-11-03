/** Invoke the installed background menu listener in copied test packages only. */
export async function observeContextMenu(directory: string) {
	const file = Bun.file(`${directory}/background.js`)
	const source = await file.text()
	const registration = /[\w$]+\.contextMenus\.onClicked\.addListener\(/gu
	const actionRegistration = /[\w$]+\.action\.onClicked\.addListener\(/gu
	if ([...source.matchAll(registration)].length !== 1) throw new Error("The background menu registration changed")
	if ([...source.matchAll(actionRegistration)].length !== 1)
		throw new Error("The background action registration changed")
	// Observe the compiled registration without replacing browser-owned API objects.
	const instrumented = source
		.replace(registration, "__probeAddContextMenu(")
		.replace(actionRegistration, "__probeAddAction(")
		.replace(/[\w$]+\.tabs\.get\(/gu, "__probeGetTab(")
		.replace(/[\w$]+\.tabs\.update\(/gu, "__probeUpdateTab(")
		.replace(/[\w$]+\.tabs\.sendMessage\(/gu, "__probeSendTab(")
		.replace(/[\w$]+\.runtime\.sendMessage\(/gu, "__probeSendRuntime(")
	await Bun.write(
		file,
		`const __probeApi=globalThis.browser??chrome;
let __probeOmitTabUrl, __probeOmittedUrl=false;
let __probeOmitReaderUrls=false, __probeOmittedReaderUrls=false;
let __probeTrace=[];
async function __probeUpdateTab(id,changes){
 const result=await __probeApi.tabs.update(id,changes);
 __probeTrace.push({type:'update-tab',id,url:changes.url});return result;
}
async function __probeSendTab(tab,...args){
 try {const result=await __probeApi.tabs.sendMessage(tab,...args);__probeTrace.push({tab,type:args[0]?.type,ok:true});return result;}
 catch(error){__probeTrace.push({tab,type:args[0]?.type,error:error.message});throw error;}
}
async function __probeSendRuntime(message){
 try {const result=await __probeApi.runtime.sendMessage(message);__probeTrace.push({type:message.type,ok:true});return result;}
 catch(error){__probeTrace.push({type:message.type,error:error.message});throw error;}
}
async function __probeGetTab(id){
 const tab=await __probeApi.tabs.get(id);
 __probeTrace.push({type:'get-tab',id,url:tab.url});
 if(__probeOmitReaderUrls&&(tab.url??tab.pendingUrl)?.startsWith(__probeApi.runtime.getURL('/pdf.html'))){
  const {url,pendingUrl,...withoutUrl}=tab;__probeOmittedReaderUrls=true;return withoutUrl;
 }
 if(id===__probeOmitTabUrl){const {url,...withoutUrl}=tab;__probeOmittedUrl=true;return withoutUrl;}
 return tab;
}
function __probeAddContextMenu(listener){
 const api=__probeApi;
 api.contextMenus.onClicked.addListener(listener);
 api.runtime.onMessage.addListener((message,sender)=>{
  if(sender.id!==api.runtime.id||message?.type!=='probe-context-menu')return;
  return (async()=>{
   __probeOmitTabUrl=message.omitTabUrl?message.tab.id:undefined;
   __probeOmittedUrl=false;
   __probeOmitReaderUrls=message.omitReaderUrls===true;__probeOmittedReaderUrls=false;
   __probeTrace=[];
   try {
    await listener(message.info,message.tab);
    const badge=await api.action.getBadgeText({tabId:message.tab.id});
    return {ok:badge!=='!',error:badge==='!'?await api.action.getTitle({tabId:message.tab.id}):undefined,omittedUrl:__probeOmittedUrl,omittedReaderUrls:__probeOmittedReaderUrls,trace:__probeTrace};
   }
   finally {__probeOmitTabUrl=undefined;__probeOmitReaderUrls=false;}
  })();
 });
}
function __probeAddAction(listener){
 __probeApi.action.onClicked.addListener(listener);
 __probeApi.runtime.onMessage.addListener((message,sender)=>{
  if(sender.id!==__probeApi.runtime.id||message?.type!=='probe-action-click')return;
  __probeTrace=[];
  listener(message.tab);
  return new Promise(resolve=>setTimeout(()=>resolve({ok:true,trace:__probeTrace}),500));
 });
}\n${instrumented}`,
	)
}
