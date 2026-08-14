/* test-model-cache.js — the Downloaded Models panel must group, size and delete
 * cached weights correctly, and must never touch the app's own shell cache.
 * Run:  node test-model-cache.js
 *
 * Written against a simulated CacheStorage because the real one only exists in
 * a browser. What it pins: grouping by HF repo, summing across a model's files,
 * CDN URLs (no repo path) kept separate rather than mis-attributed, sophia-* 
 * caches excluded, and a delete that removes one model and leaves the rest.
 */
const fs=require('fs'), vm=require('vm');
(async () => {
const html=fs.readFileSync(require('path').join(__dirname,'index.html'),'utf8');
const i0=html.indexOf('<script>',html.indexOf('<body>'));
const js=html.slice(html.indexOf('>',i0)+1, html.indexOf('</script>', i0));
function grab(n){let i=js.indexOf('async function '+n+'(');if(i<0)i=js.indexOf('function '+n+'(');
 if(i<0)throw new Error('missing '+n);let d=0,st=false;
 for(let k=i;k<js.length;k++){if(js[k]==='{'){d++;st=true}else if(js[k]==='}'){d--;if(st&&d===0)return js.slice(i,k+1)}}}
const consts = js.slice(js.indexOf('const MODEL_HOST_RE'), js.indexOf('function formatBytes'));
const store = {
  'transformers-cache': [
    ['https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-ONNX/resolve/main/onnx/model_q4.onnx', 800e6],
    ['https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-ONNX/resolve/main/tokenizer.json', 2e6],
    ['https://huggingface.co/onnx-community/gemma-4-E4B-it-ONNX/resolve/main/onnx/model_q4f16.onnx', 5.1e9],
    ['https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct/resolve/main/onnx/model_quantized.onnx', 300e6],
    ['https://cdn-lfs-us-1.huggingface.co/repos/ab/cd/blob123', 120e6],
  ],
  'sophia-v95': [['https://aetheriasos.com/index.html', 1.2e6]],
};
const caches = {
  keys: async () => Object.keys(store),
  open: async (n) => ({
    keys: async () => (store[n]||[]).map(([url]) => ({url})),
    match: async (req) => { const e=(store[n]||[]).find(([u])=>u===(req.url||req));
      return e ? {headers:{get:k=>k==='content-length'?String(e[1]):null}} : undefined; },
    delete: async (url) => { const b=(store[n]||[]).length;
      store[n]=(store[n]||[]).filter(([u])=>u!==url); return store[n].length<b; },
  }),
};
const LOCAL_MODELS={'agent-lite':{id:'LiquidAI/LFM2.5-1.2B-Instruct-ONNX',name:'LFM2.5-1.2B — Agent Lite'},
  'e4b':{id:'onnx-community/gemma-4-E4B-it-ONNX',name:'Gemma 4 E4B — Warm Deep'},
  'tiny':{id:'onnx-community/Qwen2.5-0.5B-Instruct',name:'Qwen 0.5B — Spark'}};
const ctx={console,Math,Object,Array,String,Number,Map,Set,JSON,Promise,
  window:{caches}, caches, LOCAL_MODELS, selectedLocalModel:'agent-lite',
  localInference:{ready:false}, out:{}};
ctx.global=ctx;vm.createContext(ctx);
vm.runInContext([consts,grab('formatBytes'),grab('modelKeyFromUrl'),grab('friendlyModelName'),
  grab('listCachedModels'),'out.list=listCachedModels; out.fmt=formatBytes;'].join('\n'),ctx);
let fail=0;const ok=(c,m)=>{console.log((c?'  ok   ':'  FAIL ')+m);if(!c)fail++;};
const d=await ctx.out.list();
console.log('  found:');
d.groups.forEach(g=>console.log(`    ${ctx.out.fmt(g.bytes).padStart(8)}  ${g.name}  (${g.count} files)`));
if(d.unattributed) console.log(`    ${ctx.out.fmt(d.unattributed.bytes).padStart(8)}  [CDN, no repo in URL] (${d.unattributed.count})`);
console.log();
ok(d.groups.length===3,`three models grouped (got ${d.groups.length})`);
ok(d.groups[0].name.includes('E4B'),'sorted biggest first: '+d.groups[0].name);
const lfm=d.groups.find(g=>g.repo.includes('LFM2.5'));
ok(lfm.count===2,'both LFM files grouped under one model');
ok(lfm.bytes===802e6,"sizes summed across a model's files");
ok(!!d.unattributed && d.unattributed.count===1,'CDN file kept separate, not mis-attributed');
ok(d.groups.every(g=>!/aetheriasos/.test(g.repo)),'the app shell cache is never listed');
ok(lfm.key==='agent-lite','maps back to the model picker key');
const target=d.groups.find(g=>g.repo.includes('gemma-4-E4B'));
for(const ref of target.refs){ const c=await caches.open(ref.cacheName); await c.delete(ref.url); }
const after=await ctx.out.list();
ok(!after.groups.some(g=>g.repo.includes('gemma-4-E4B')),'deleted model is gone');
ok(after.groups.length===2,'the other two models survive');
ok(store['sophia-v95'].length===1,'the app shell cache is untouched by a model delete');
console.log(fail?`\n${fail} FAILED`:'\nmodel cache manager OK');
process.exit(fail?1:0);
})();
