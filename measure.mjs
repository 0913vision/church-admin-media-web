import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import WebSocket from '/Users/kim-yoochan/coding/church-media-server/node_modules/ws/index.js';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', PORT=9334;
const chrome=spawn(CHROME,['--headless=new',`--remote-debugging-port=${PORT}`,'--hide-scrollbars','--user-data-dir=/tmp/gate-chrome','--allow-file-access-from-files','--window-size=400,400','--force-device-scale-factor=3','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let url; for(let i=0;i<60;i++){try{const l=await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r=>r.json());const p=l.find(t=>t.type==='page');if(p){url=p.webSocketDebuggerUrl;break}}catch{}await sleep(250)}
const ws=new WebSocket(url); await new Promise(r=>ws.once('open',r));
let id=0; const pend=new Map(); ws.on('message',raw=>{const m=JSON.parse(raw.toString());if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id)}});
const send=(method,params={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method,params}))});
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate',{url:`file://${process.argv[2]}`}); await sleep(1200);
const r=await send('Runtime.evaluate',{returnByValue:true,expression:`(()=>{
  const q=s=>document.querySelector(s).getBoundingClientRect();
  const g=q('#g'), d=q('#d'), l=q('#l');
  const t=q('#t'), ti=q('#ti'), tl=q('#tl');
  return {
    gate:{w:Math.round(g.width), leftOfDot:Math.round(d.left-g.left), dotToText:Math.round(l.left-d.right), rightOfText:Math.round(g.right-l.right), textW:Math.round(l.width)},
    tab:{w:Math.round(t.width), leftOfIcon:Math.round(ti.left-t.left), iconToText:Math.round(tl.left-ti.right), rightOfText:Math.round(t.right-tl.right)}
  };})()`});
console.log(JSON.stringify(r.result.result.value,null,1));
const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
writeFileSync('/tmp/gate.png',Buffer.from(shot.result.data,'base64'));
ws.close(); chrome.kill();
