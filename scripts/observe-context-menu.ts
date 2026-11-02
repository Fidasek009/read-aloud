/** Invoke the installed background menu listener in copied test packages only. */
export async function observeContextMenu(directory: string) {
	const file = Bun.file(`${directory}/background.js`)
	const source = await file.text()
	const registration = /[\w$]+\.contextMenus\.onClicked\.addListener\(/gu
	if ([...source.matchAll(registration)].length !== 1) throw new Error("The background menu registration changed")
	// Observe the compiled registration without replacing browser-owned API objects.
	const instrumented = source
		.replace(registration, "__probeAddContextMenu(")
		.replace(/[\w$]+\.tabs\.get\(/gu, "__probeGetTab(")
		.replace(/[\w$]+\.tabs\.sendMessage\(/gu, "__probeSendTab(")
		.replace(/[\w$]+\.runtime\.sendMessage\(/gu, "__probeSendRuntime(")
	await Bun.write(
		file,
		`const __probeApi=globalThis.browser??chrome;
let __probeOmitTabUrl, __probeOmittedUrl=false;
let __probeTrace=[];
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
   __probeTrace=[];
   try {
    await listener(message.info,message.tab);
    const badge=await api.action.getBadgeText({tabId:message.tab.id});
    return {ok:badge!=='!',error:badge==='!'?await api.action.getTitle({tabId:message.tab.id}):undefined,omittedUrl:__probeOmittedUrl,trace:__probeTrace};
   }
   finally {__probeOmitTabUrl=undefined;}
  })();
 });
}\n${instrumented}`,
	)
}
