"use strict";
// Plain-text outcomes with a sequence number, read from the accessibility tree by the runner.
// At load the probe constructs an AudioContext, starts a quiet continuous tone and asks to open
// audio without any tap, so the runner can check that nothing is heard (host mute) until a tap.
const $=id=>document.getElementById(id);
let seq=0,ctx=null,events=[];
function report(text){$("status").textContent=text+" #"+(++seq);}
function task(fn){return async()=>{try{report(await fn());}catch(error){report("["+(error.code||error.name||"UNAVAILABLE")+"] "+error.message);}};}
function tone(){
  try{ctx=new AudioContext();const o=ctx.createOscillator(),g=ctx.createGain();g.gain.value=0.05;o.frequency.value=440;o.connect(g).connect(ctx.destination);o.start();
    $("ctor").textContent="Constructor: available ("+ctx.state+")";}
  catch(error){$("ctor").textContent="Constructor: "+(error.name||"error");}
}
window.addEventListener("constructaudio",e=>{events.push(e.detail.state+":"+e.detail.reason);$("events").textContent="Audio events: "+events.join(", ");});
tone();
call("audio.play",{op:"open"}).then(r=>{$("load").textContent="Load open: "+JSON.stringify(r);},e=>{$("load").textContent="Load open: ["+(e.code||"ERROR")+"]";});
$("open").onclick=task(async()=>{const r=await call("audio.play",{op:"open"});if(ctx&&ctx.state!=="running")await ctx.resume();return "Open: "+JSON.stringify(r)+" context "+(ctx?ctx.state:"none");});
$("state").onclick=task(async()=>"State: "+JSON.stringify(await call("audio.play",{op:"state"})));
$("close").onclick=task(async()=>"Close: "+JSON.stringify(await call("audio.play",{op:"close"})));
