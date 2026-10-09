import{test}from'node:test';import assert from'node:assert/strict';import{mkdtemp,readFile,stat,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{spawn}from'node:child_process';import{once}from'node:events';
import{parse,tokenize}from'../dist/cli/src/parser.js';
import{openSession}from'../dist/cli/src/session.js';
import{CookieJar}from'tough-cookie';
import{api,closeConnections}from'../dist/cli/src/api-client.js';
import{createServer}from'node:http';
test('same parser handles chat, escaping, argv, and command errors',()=>{
assert.equal(parse(['//help']).text,'/help');assert.equal(parse(['/say','--','/help']).text,'/help');
assert.deepEqual(parse(tokenize('/ask --use-personal-points "他认识她吗？"')),parse(['/ask','--use-personal-points','他认识她吗？']));
assert.throws(()=>parse(['/shell','rm','-rf']),/INVALID_COMMAND/);assert.throws(()=>parse(['/join','ABCDEF','--password','123456']),/INVALID_INPUT/);
});
test('cookie jar respects domain, path, Secure, expiry, chunks',()=>{
const jar=new CookieJar();jar.setCookieSync('sb-auth.0=abc; Path=/; Secure','https://example.com');jar.setCookieSync('sb-auth.1=def; Path=/api; Secure','https://example.com');
assert.equal(jar.getCookieStringSync('https://attacker.example/'),'');assert.equal(jar.getCookieStringSync('http://example.com/'),'');
assert.equal(jar.getCookieStringSync('https://example.com/'),'sb-auth.0=abc');assert.match(jar.getCookieStringSync('https://example.com/api/state'),/sb-auth.1=def/);
jar.setCookieSync('sb-auth.0=; Max-Age=0; Path=/; Secure','https://example.com');assert.equal(jar.getCookieStringSync('https://example.com/'),'');
});
test('OS lock rejects second process and releases after SIGKILL; permissions and atomic state',async()=>{
const home=await mkdtemp(join(tmpdir(),'soup-lock-'));const prior=process.env.ONLINESOUP_HOME;process.env.ONLINESOUP_HOME=home;
try{
const child=spawn(process.execPath,['--input-type=module','-e',`import {openSession} from ${JSON.stringify(new URL('../dist/cli/src/session.js',import.meta.url).href)};const s=await openSession('https://example.com');await s.save();console.log('READY');setInterval(()=>{},10000);`],{env:{...process.env},stdio:['ignore','pipe','pipe']});
await once(child.stdout,'data');await assert.rejects(()=>openSession('https://example.com'),/LOCAL_SESSION_BUSY/);
child.kill('SIGKILL');await once(child,'exit');const s=await openSession('https://example.com');await s.save();await s.close();
if(process.platform!=='win32'){assert.equal((await stat(home)).mode&0o777,0o700);assert.equal((await stat(join(home,'session.json'))).mode&0o777,0o600);}
assert.equal(JSON.parse(await readFile(join(home,'session.json'),'utf8')).origin,'https://example.com');
}finally{if(prior===undefined)delete process.env.ONLINESOUP_HOME;else process.env.ONLINESOUP_HOME=prior;await rm(home,{recursive:true,force:true});}
});
test('write 504 remains unknown, cookies persisted, no redirect credential forwarding',async()=>{
const server=createServer((req,res)=>{res.setHeader('Set-Cookie',['sb-a.0=one; Path=/','sb-a.1=two; Path=/']);res.statusCode=req.url.includes('redirect')?302:504;res.setHeader('Location','http://127.0.0.1:1/steal');res.end('gateway');});server.listen(0,'127.0.0.1');await once(server,'listening');
const home=await mkdtemp(join(tmpdir(),'soup-http-'));const prior=process.env.ONLINESOUP_HOME;process.env.ONLINESOUP_HOME=home;const s=await openSession(`http://127.0.0.1:${server.address().port}`);
try{const result=await api(s,'/write',{},'key');assert.equal(result.error.code,'REQUEST_RESULT_UNKNOWN');assert.match(s.jar.getCookieStringSync(s.state.origin),/sb-a.1=two/);assert.equal((await api(s,'/redirect')).error.code,'SERVER_ERROR');}
finally{await s.close();server.close();await closeConnections();if(prior===undefined)delete process.env.ONLINESOUP_HOME;else process.env.ONLINESOUP_HOME=prior;await rm(home,{recursive:true,force:true});}
});

test('request retention preserves recent unknown writes and removes expired payloads',async()=>{
const home=await mkdtemp(join(tmpdir(),'soup-retention-'));const prior=process.env.ONLINESOUP_HOME;process.env.ONLINESOUP_HOME=home;
const s=await openSession('https://example.com');
try{
s.state.pending.old={key:'old',action:'say',room:'ABCDEF',payload:{content:'private old body'},created_at:Date.now()-8*86400000};
s.state.pending.unknown={key:'unknown',action:'say',room:'ABCDEF',payload:{content:'recover me'},created_at:Date.now()};
await s.save();const stored=await readFile(join(home,'session.json'),'utf8');assert.equal(stored.includes('private old body'),false);assert.equal(JSON.parse(stored).pending.unknown.payload.content,'recover me');
}finally{await s.close();if(prior===undefined)delete process.env.ONLINESOUP_HOME;else process.env.ONLINESOUP_HOME=prior;await rm(home,{recursive:true,force:true});}
});

test('password room reads stdin without argv or local secret and completed requests are cleared',async()=>{
let received;const server=createServer(async(req,res)=>{
res.setHeader('Content-Type','application/json');
if(req.url.endsWith('/join-info'))return res.end(JSON.stringify({api_version:1,ok:true,error:null,data:{requires_password:true}}));
let body='';for await(const chunk of req)body+=chunk;received=JSON.parse(body);
res.end(JSON.stringify({api_version:1,ok:true,error:null,data:{status:'completed'}}));
});server.listen(0,'127.0.0.1');await once(server,'listening');
const home=await mkdtemp(join(tmpdir(),'soup-password-'));
try{
const child=spawn(process.execPath,[new URL('../dist/cli/src/main.js',import.meta.url).pathname,'--json','--password-stdin','/join','ABCDEF'],{env:{...process.env,ONLINESOUP_HOME:home,ONLINESOUP_URL:`http://127.0.0.1:${server.address().port}`},stdio:['pipe','pipe','pipe']});
let out='';child.stdout.on('data',c=>out+=c);child.stdin.end('654321\n');await once(child,'close');assert.equal(JSON.parse(out).ok,true);assert.equal(received.password,'654321');
const stored=await readFile(join(home,'session.json'),'utf8');assert.equal(stored.includes('654321'),false);assert.deepEqual(JSON.parse(stored).pending,{});
}finally{server.close();await rm(home,{recursive:true,force:true});}
});
