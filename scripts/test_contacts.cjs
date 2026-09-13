const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
async function app(withLabels=true){
 const els=new Map(),calls=[];let reject=null;
 function element(){return {children:[],hidden:false,disabled:false,textContent:'',value:'',append(n){this.children.push(n)},replaceChildren(){this.children=[]},querySelectorAll(){return this.children}};}
 const el=id=>{if(!els.has(id))els.set(id,element());return els.get(id);};
 const handlers={},context={document:{getElementById:el,createElement:element,visibilityState:'visible',addEventListener:(k,f)=>handlers[k]=f},Date:{now:()=>10000+calls.length*1000},setTimeout:f=>f(),call:async(method,params)=>{
  calls.push({method,params});if(reject)throw {code:reject};
  if(params.op==='get')return {name:'<script>fake</script>',phones:['+15550000000'],phoneLabels:withLabels?['Mobile']:undefined,emails:[],limited:false};
  return {items:params.query==='none'?[]:[{ref:'opaque',name:'<script>fake</script>'}],next:null,limited:false};
 }};
 vm.runInNewContext(fs.readFileSync('examples/contacts-module/ui/app.js','utf8'),context);
 el('query').value='Synthetic';
 return {el,calls,handlers,context,deny:(code='CAPABILITY_DENIED')=>reject=code,browse:()=>el('browse').onclick(),search:()=>vm.runInNewContext('search()',context),detail:()=>vm.runInNewContext("detail('opaque')",context)};
}
test('contacts are read only on search; display strings stay text, never markup',async()=>{
 const a=await app();assert.equal(a.calls.length,0);await a.search();
 assert.equal(a.el('results').children[0].textContent,'<script>fake</script>');await a.detail();assert.equal(a.el('name').textContent,'<script>fake</script>');
 assert.deepEqual(a.calls.map(c=>c.method),['contacts.read','contacts.read']);
});
test('denial clears previously displayed contact data and page references',async()=>{
 const a=await app();await a.search();await a.detail();a.deny();await a.search();
 assert.equal(a.el('results').children.length,0);assert.equal(a.el('name').textContent,'');assert.equal(a.el('phones').children.length,0);assert.match(a.el('status').textContent,/CAPABILITY_DENIED/);
});
test('empty search is clear; hidden view discards rendered personal data',async()=>{
 const a=await app();a.el('query').value='none';await a.search();assert.equal(a.el('status').textContent,'No matching contacts.');
 a.el('query').value='';await a.browse();await a.detail();a.context.document.visibilityState='hidden';a.handlers.visibilitychange();assert.equal(a.el('name').textContent,'');assert.equal(a.el('results').children.length,0);
});
test('browser scripts compile together without bridge lexical conflicts',()=>{
 assert.doesNotThrow(()=>new vm.Script(['bridge.js','app.js'].map(n=>fs.readFileSync('examples/contacts-module/ui/'+n,'utf8')).join('\n')));
});

test('blank Search requires explicit Browse and never reads implicitly',async()=>{
 const a=await app();a.el('query').value='';await a.search();assert.equal(a.calls.length,0);assert.match(a.el('status').textContent,/choose Browse/);
 await a.browse();assert.equal(a.calls.length,1);assert.equal(a.calls[0].params.query,'');assert.equal(a.el('status').textContent,'1 contact shown.');
});
test('timeout and busy guidance does not promise an immediate retry',async()=>{
 for(const code of ['CONTACTS_TIMEOUT','CONTACTS_BUSY']){const a=await app();a.deny(code);await a.search();assert.match(a.el('status').textContent,/close and reopen/i);assert.doesNotMatch(a.el('status').textContent,/Try searching again/);assert.equal(a.el('go').disabled,false);}
});
test('typed values keep optional labels and safely render as text',async()=>{
 const a=await app();await a.detail();assert.equal(a.el('phones').children[0].textContent,'Mobile: +15550000000');assert.equal(a.el('emails').children[0].textContent,'None listed');
});

test('older API0.3 hosts without optional type labels still render plain values',async()=>{
 const a=await app(false);await a.detail();assert.equal(a.el('phones').children[0].textContent,'+15550000000');
});
