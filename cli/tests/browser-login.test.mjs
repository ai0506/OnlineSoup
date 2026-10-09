import{test}from'node:test';import assert from'node:assert/strict';import{createServer}from'node:http';import{once}from'node:events';import{mkdtemp,rm,readFile}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{spawn}from'node:child_process';import{createHash,randomUUID}from'node:crypto';
import{parse}from'../dist/cli/src/parser.js';
test('browser login flags share parser and password login remains available',()=>{assert.equal(parse(['/login']).text,'');assert.equal(parse(['/login','--no-browser']).options['no-browser'],true);assert.equal(parse(['/login','--wait']).options.wait,true);assert.equal(parse(['/login','Name']).text,'Name');assert.throws(()=>parse(['/join','--browser']),/INVALID_INPUT/);});
test('JSON device flow persists private proof, resumes after unknown response and acknowledges only after local save',async()=>{
const home=await mkdtemp(join(tmpdir(),'soup-browser-test-')),id=randomUUID(),user=randomUUID();let start,polls=0,acked=false;
const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const data=JSON.parse(body);res.setHeader('Content-Type','application/json');let result;
if(req.url.endsWith('/start')){start=data;result={id,user_code:'ABCDEFGH',expires_in:300};}
if(req.url.endsWith('/poll')){assert.equal(data.secret,start.secret);assert.equal(createHash('sha256').update(data.verifier).digest('hex'),start.challenge);if(++polls===1){res.statusCode=503;return res.end('{}');}res.setHeader('Set-Cookie','sb-own=private-login-cookie; Path=/');result={status:'completed',user_id:user,username:'Player1'};}
if(req.url.endsWith('/ack')){const stored=JSON.parse(await readFile(join(home,'session.json'),'utf8'));assert.equal(stored.user_id,user);assert.equal(stored.browser_login,undefined);acked=true;result={status:'consumed'};}
res.end(JSON.stringify({api_version:1,ok:true,error:null,data:result}));});server.listen(0,'127.0.0.1');await once(server,'listening');
async function cli(args){const child=spawn(process.execPath,[new URL('../dist/cli/src/main.js',import.meta.url).pathname,'--json',...args],{env:{...process.env,ONLINESOUP_HOME:home,ONLINESOUP_URL:`http://127.0.0.1:${server.address().port}`},stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);await once(child,'close');return{result:JSON.parse(out),out,err};}
try{
const first=await cli(['/login']);assert.equal(first.result.data.status,'authorization_required');assert.equal(first.result.data.user_code,'ABCD-EFGH');assert.equal(first.out.includes(start.secret),false);assert.equal(first.out.includes(start.challenge),false);assert.ok(JSON.parse(await readFile(join(home,'session.json'),'utf8')).browser_login.verifier);
const second=await cli(['/login','--wait']);assert.equal(second.result.ok,true);assert.equal(second.result.data.username,'Player1');assert.equal(acked,true);assert.equal(polls,2);assert.equal((second.out+second.err).includes('private-login-cookie'),false);assert.equal((second.out+second.err).includes(start.secret),false);
}finally{server.close();await rm(home,{recursive:true,force:true});}
});
