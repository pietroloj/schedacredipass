const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../web/app.js'),'utf8');
const fragment=source.slice(source.indexOf('const hubBase='),source.indexOf('async function api('));
async function run(){
 let calls=0;
 const auth={app:{options:{projectId:'consulenza-credipass'}},currentUser:{getIdToken:async()=>{calls++;return 'fake-token'}}};
 const context=vm.createContext({window:{CREDIPASS_FIREBASE:{auth}},document:{querySelector:()=>({content:'/social-hub'})},boot:{project:'consulenza-credipass'}});
 vm.runInContext(fragment,context);
 await vm.runInContext('setupSharedAuth()',context);
 assert.equal(await vm.runInContext('idToken()',context),'fake-token');assert.equal(calls,1);
 auth.currentUser=null;assert.equal(await vm.runInContext('idToken()',context),'');
 auth.app.options.projectId='wrong-project';await assert.rejects(vm.runInContext('setupSharedAuth()',context),/non corrispondente/);
 console.log('PASS: reuse existing auth, token refresh delegation, signed-out state, reject mismatched project');
}
run().catch(e=>{console.error(e);process.exitCode=1});
