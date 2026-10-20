// Exercise the same ZIP reader/grouping/import functions as the browser without a live account.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{webcrypto}=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../web/app.js'),'utf8');
function zip(files){let offset=0;const local=[],central=[];for(const [name,text] of files){const n=Buffer.from(name),d=Buffer.from(text),h=Buffer.alloc(30),c=Buffer.alloc(46);h.writeUInt32LE(0x04034b50);h.writeUInt32LE(d.length,18);h.writeUInt32LE(d.length,22);h.writeUInt16LE(n.length,26);c.writeUInt32LE(0x02014b50);c.writeUInt32LE(d.length,20);c.writeUInt32LE(d.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);local.push(h,n,d);central.push(c,n);offset+=h.length+n.length+d.length}const dir=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,10);end.writeUInt32LE(dir.length,12);end.writeUInt32LE(offset,16);return new Blob([...local,dir,end])}
async function run(){const elements={},calls=[];const ctx=vm.createContext({Uint8Array,DataView,TextDecoder,TextEncoder,Blob,File,URL,DecompressionStream,Error,Map,crypto:webcrypto,zipItems:[],zipOffice:'',zipBusy:false,tab:'importer',state:{connections:[],posts:[],offices:[]},esc:x=>String(x).replaceAll('<','&lt;'),action:()=>'',imageInfo:async()=>({width:1200,height:628,preview:'blob:test'}),file64:async f=>Buffer.from(await f.arrayBuffer()).toString('base64'),$:id=>elements[id]||(elements[id]={value:'1',innerHTML:'',textContent:'',disabled:false,checked:true}),api:async(route,d)=>{calls.push({route,d});return {media:'asset:00000000000000000000000000000001.jpg',schedule:[],warnings:[],scheduled:0,connections:[],posts:[],offices:[]}},load:async()=>{},toast:()=>{}});
vm.runInContext(source.slice(source.indexOf('const formats='),source.indexOf('let calendarDate=')),ctx);
vm.runInContext(source.slice(source.indexOf('function slotSlides('),source.indexOf('function slotMarkup(')),ctx);
vm.runInContext(source.slice(source.indexOf('async function uploadSlot('),source.indexOf('// Read central directory')),ctx);
vm.runInContext(source.slice(source.indexOf('async function zipRead'),source.indexOf("document.addEventListener('input',e=>{if(e.target.closest")),ctx);
// Exercise the real composer selection/upload path as well as ZIP import.
ctx.activeSlot='instagram';ctx.draftSlots={};ctx.draftFiles={};ctx.formDirty=false;
vm.runInContext(source.slice(source.indexOf('function slotMarkup('),source.indexOf('function postForm(')),ctx);
vm.runInContext(source.slice(source.indexOf('function keepSlotText('),source.indexOf('// Read central directory')),ctx);
const image=name=>new File(['image'],name,{type:'image/png'});
await ctx.selectSlotFile([image('slide_10.png'),image('slide_2.png')]);
await ctx.selectSlotFile([image('slide_3.png')]);
assert.deepEqual(Array.from(ctx.draftSlots.instagram.slides,s=>s.name),['slide_2.png','slide_10.png','slide_3.png']);
assert.match(ctx.slotMarkup('instagram'),/type="file" multiple/);assert.match(ctx.slotMarkup('story'),/type="file" multiple/);
assert.equal(ctx.formDirty,true);const saved=await ctx.uploadSlot(ctx.draftSlots.instagram,'1');assert.equal(saved.media_items.length,3);
const uploadedBefore=calls.filter(c=>c.route==='upload').length;await ctx.uploadSlot(ctx.draftSlots.instagram,'1');assert.equal(calls.filter(c=>c.route==='upload').length,uploadedBefore);
await assert.rejects(ctx.selectSlotFile(Array.from({length:8},(_,i)=>image(i+'.png'))),/Massimo 10/);
ctx.activeSlot='story';await ctx.selectSlotFile([image('1.png'),image('2.png')]);assert.equal(ctx.draftSlots.story.slides.length,2);await assert.rejects(ctx.selectSlotFile(Array.from({length:19},(_,i)=>image(i+'.png'))),/Massimo 20/);
calls.length=0;
const folders=['Facebook','Instagram','LinkedIn','Stories_FB_IG','Reel_FB_IG','TikTok'];const fixture=zip(folders.flatMap(f=>[[`Pack/01_LUNEDI/01_Titolo/${f}/image.png`,'image'],[`Pack/01_LUNEDI/01_Titolo/${f}/TESTO_DA_COPIARE.txt`,`Testo ${f}`]]));
await ctx.inspectZip(fixture);assert.equal(ctx.zipItems.length,1);assert.equal(Object.keys(ctx.zipItems[0].slots).length,6);assert.equal(ctx.zipItems[0].day_label,'LUNEDI');assert.equal(ctx.zipItems[0].slots.instagram.body,'Testo Instagram');await ctx.importPack();assert.equal(calls.filter(c=>c.route==='upload').length,6);const post=calls.find(c=>c.route==='import/post').d;assert.equal(post.slots.story.body,'Testo Stories_FB_IG');assert.equal(post.body,'Testo Instagram');assert.equal(calls.filter(c=>c.route==='job').length,0);assert.equal(post.auto_approve,true);assert.equal(ctx.zipItems.length,0);
await assert.rejects(ctx.zipRead(new Blob(['bad zip'])));await assert.rejects(ctx.zipRead(zip([['../Facebook/a.png','test']])));
// Partial import can be retried without saving already-completed cards again.
await ctx.inspectZip(fixture);let fail=true;ctx.api=async(route,d)=>{if(route==='import/post'&&fail){fail=false;throw Error('interrupted')}calls.push({route,d});return {media:'asset:00000000000000000000000000000001.jpg',schedule:[],warnings:[],scheduled:0,connections:[],posts:[],offices:[]}};await assert.rejects(ctx.importPack());const uploads=calls.filter(c=>c.route==='upload').length;await ctx.importPack();assert.equal(calls.filter(c=>c.route==='upload').length,uploads);
const carousel=zip([['Pack/01_LUNEDI/01_Carousel/Instagram/slide_10.png','ten'],['Pack/01_LUNEDI/01_Carousel/Instagram/slide_2.png','two'],['Pack/01_LUNEDI/01_Carousel/Instagram/slide_1.png','one'],['Pack/01_LUNEDI/01_Carousel/Instagram/._slide_1.png','metadata']]);
await ctx.inspectZip(carousel);assert.deepEqual(Array.from(ctx.zipItems[0].slots.instagram.slides,s=>s.name),['slide_1.png','slide_2.png','slide_10.png']);
const before=calls.length;let uploaded=0;ctx.api=async(route,d)=>{calls.push({route,d});return {media:'https://example.com/'+(++uploaded)+'.jpg',schedule:[],warnings:[],scheduled:0,connections:[],posts:[],offices:[]}};
await ctx.importPack();const carouselPost=calls.slice(before).find(c=>c.route==='import/post').d;assert.equal(carouselPost.slots.instagram.media_items.length,3);assert.deepEqual(Array.from(carouselPost.slots.instagram.media_items),['https://example.com/1.jpg','https://example.com/2.jpg','https://example.com/3.jpg']);
await assert.rejects(ctx.inspectZip(zip(Array.from({length:11},(_,i)=>['Pack/01_LUNEDI/01_Carousel/Instagram/'+i+'.png','image']))),/Troppe immagini/);
const stories=zip(Array.from({length:20},(_,i)=>[`Pack/01_LUNEDI/01_Storie/Stories_FB_IG/${String(i+1).padStart(2,'0')}.png`,'image']));
await ctx.inspectZip(stories);assert.equal(ctx.zipItems[0].slots.story.slides.length,20);
await assert.rejects(ctx.inspectZip(zip(Array.from({length:21},(_,i)=>[`Pack/01_LUNEDI/01_Storie/Stories_FB_IG/${i}.png`,'image']))),/massimo 20/);
await ctx.inspectZip(zip([['Pack/01_LUNEDI/01_Testo/Facebook/TESTO_DA_COPIARE.txt','Solo testo']]));assert.equal(ctx.zipItems.length,1);assert.equal(ctx.zipItems[0].slots.facebook.body,'Solo testo');
await ctx.inspectZip(zip([['Pack/01_LUNEDI/01_Video/Reel_FB_IG/video.mp4','video'],['Pack/01_LUNEDI/01_Video/Documento_LinkedIn/guida.pdf','pdf']]));assert.equal(ctx.zipItems[0].slots.reel.slides.length,1);assert.equal(ctx.zipItems[0].slots.linkedin_document.slides.length,1);
ctx.validateSlotFiles('instagram',[image('foto.png'),new File(['v'],'video.mp4',{type:'video/mp4'})]);
assert.throws(()=>ctx.validateSlotFiles('tiktok',[image('foto.png'),new File(['v'],'video.mp4')]),/un solo video/);
assert.throws(()=>ctx.validateSlotFiles('facebook',[new File(['v'],'video.mp4')]),/non supportato/);
if(process.argv[2]){await ctx.inspectZip(new Blob([fs.readFileSync(process.argv[2])]));assert.equal(ctx.zipItems.length,10);assert.equal(ctx.zipItems.reduce((n,p)=>n+Object.values(p.slots).reduce((n,v)=>n+(v.slides?.length||0),0),0),60);console.log('PASS: real package, 10 cards and 60 assets with captions')}
console.log('PASS: ZIP grouping, per-channel captions, automatic approval payload, schedule metadata, malformed paths, partial retry');}
run().catch(e=>{console.error(e);process.exitCode=1});
