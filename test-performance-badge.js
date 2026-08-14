/* test-performance-badge.js — the Performance Status badge must say what is
 * actually answering. Run:  node test-performance-badge.js
 *
 * Shipped bug it pins: nothing ever wrote to #performanceBadge, AND
 * updateContextInfo() rebuilt the span without its id — so the element the
 * lookup wanted stopped existing after the first 3 s tick, the lookup returned
 * null, and the code wrote its own 'Auto-detecting...' fallback back in, forever.
 * exportChat() recorded that placeholder as the model in every export.
 */
const fs=require('fs'), vm=require('vm');
const html=fs.readFileSync(require('path').join(__dirname,'index.html'),'utf8');
const i0=html.indexOf('<script>',html.indexOf('<body>'));
const js=html.slice(html.indexOf('>',i0)+1, html.indexOf('</script>', i0));
function grab(n){let i=js.indexOf('function '+n+'(');if(i<0)i=js.indexOf('async function '+n+'(');
 if(i<0)throw new Error('missing '+n);let d=0,st=false;
 for(let k=i;k<js.length;k++){if(js[k]==='{'){d++;st=true}else if(js[k]==='}'){d--;if(st&&d===0)return js.slice(i,k+1)}}}

const LOCAL_MODELS={'agent-lite':{id:'LiquidAI/LFM2.5-1.2B-Instruct-ONNX',name:'LFM2.5-1.2B-Instruct — Agent Lite',download:'~0.8 GB'}};
function mk(over){
  const els={forceWasm:{checked:over.forceWasm||false}};
  const ctx={console,Object,String,LOCAL_MODELS,selectedLocalModel:'agent-lite',
    document:{getElementById:id=>els[id]||null},
    localInference:over.li, config:over.config||{}, out:{}};
  ctx.global=ctx;vm.createContext(ctx);
  vm.runInContext(grab('describeActiveModel')+'\nout.d=describeActiveModel();',ctx);
  return ctx.out.d;
}
let fail=0;const ok=(c,m)=>{console.log((c?'  ok   ':'  FAIL ')+m);if(!c)fail++;};

const cases=[
 ['loaded on WebGPU', {li:{ready:true,webgpuAvailable:true}}, /^LFM2\.5-1\.2B-Instruct · WebGPU$/],
 ['loaded, Force WASM', {li:{ready:true,webgpuAvailable:true},forceWasm:true}, /· WASM$/],
 ['no WebGPU at all',  {li:{ready:true,webgpuAvailable:false}}, /· WASM$/],
 ['loading',           {li:{loading:true,webgpuAvailable:true}}, /^⏳ Loading LFM2\.5-1\.2B-Instruct…$/],
 ['load failed',       {li:{failed:true,error:'OOM',webgpuAvailable:true}}, /^⚠️ .* failed to load$/],
 ['idle, remote named',{li:{},config:{remoteModel:'gemma-4-e4b-it'}}, /^Remote · gemma-4-e4b-it$/],
 ['idle, remote unnamed',{li:{},config:{}}, /^Remote API$/],
 ['idle, local-only mode',{li:{},config:{inferenceMode:'local'}}, /^No model loaded$/],
];
for(const [label,over,re] of cases){
  const d=mk(over);
  ok(re.test(d.text), `${label.padEnd(22)} → "${d.text}"`);
}
// the placeholder must be gone for good
const all=cases.map(c=>mk(c[1]).text).join(' ');
ok(!/Auto-detecting|Auto-selected/.test(all), 'no state reports the old placeholder');
// and the rebuilt span must keep its id, or this all regresses
const uci=grab('updateContextInfo');
ok(/id="performanceBadge"/.test(uci), 'updateContextInfo re-emits the id it used to drop');
ok(/describeActiveModel\(\)/.test(uci), 'and takes its text from real state');
console.log(fail?`\n${fail} FAILED`:'\nperformance badge OK');
process.exit(fail?1:0);
