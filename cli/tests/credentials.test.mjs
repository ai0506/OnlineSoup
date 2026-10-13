import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,writeFile,readFile,chmod,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readCredentials} from '../dist/cli/src/credentials.js';

test('credential files accept UTF-8 BOM without trimming the password and never expose invalid contents',async()=>{
  const root=await mkdtemp(join(tmpdir(),'soup-credentials-')),file=join(root,'account.json');
  try{
    await writeFile(file,'\uFEFF'+JSON.stringify({identity:' PlayerA ',password:' pass word '}),{mode:0o600});
    assert.deepEqual(await readCredentials(file),{identity:'PlayerA',password:' pass word '});
    for(const text of ['{"password":"private-secret",BROKEN',JSON.stringify({identity:'PlayerA',password:'123'}),JSON.stringify({identity:'PlayerA',password:'private-secret',extra:true})]){
      await writeFile(file,text);
      await assert.rejects(()=>readCredentials(file),e=>e.message==='INVALID_CREDENTIALS_FILE'&&!JSON.stringify(e).includes('private-secret'));
    }
    await assert.rejects(()=>readCredentials(root),/INVALID_CREDENTIALS_FILE/);
    await assert.rejects(()=>readCredentials(file+'-missing'),/INVALID_CREDENTIALS_FILE/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('credential files reject public permissions and symlinks on POSIX',{skip:process.platform==='win32'},async()=>{
  const root=await mkdtemp(join(tmpdir(),'soup-credentials-permissions-')),file=join(root,'account.json');
  try{
    await writeFile(file,JSON.stringify({identity:'PlayerA',password:'private-secret'}),{mode:0o600});
    await chmod(file,0o644);await assert.rejects(()=>readCredentials(file),/UNSAFE_CREDENTIALS_FILE/);
    await chmod(file,0o600);await symlink(file,file+'-link');await assert.rejects(()=>readCredentials(file+'-link'),/INVALID_CREDENTIALS_FILE/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('two CLI processes log in from separate account files and persist independent identities without passwords',async()=>{
  const root=await mkdtemp(join(tmpdir(),'soup-agent-accounts-')),received=[];
  const server=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    const data=JSON.parse(body);received.push(data);
    res.setHeader('Content-Type','application/json');res.setHeader('Set-Cookie',`sb-auth=${data.identity}; Path=/`);
    res.end(JSON.stringify({api_version:1,ok:true,error:null,data:{authenticated:true,user_id:data.identity,username:data.identity}}));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  async function run(name,extra=[]){
    const home=join(root,name),file=join(root,name+'.json'),secret=name+'-private-password';
    await writeFile(file,JSON.stringify({identity:name,password:secret}),{mode:0o600});
    const args=['--json',...extra,'/login','--credentials-file',file];
    const child=spawn(process.execPath,[fileURLToPath(new URL('../dist/cli/src/main.js',import.meta.url)),...args],{env:{...process.env,ONLINESOUP_HOME:home,ONLINESOUP_URL:`http://127.0.0.1:${server.address().port}`},stdio:['ignore','pipe','pipe']});
    let output='',error='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>error+=c);
    const [code]=await once(child,'close');assert.ok(!(output+error).includes(secret));
    return {code,result:JSON.parse(output),home,secret};
  }
  try{
    const agents=await Promise.all([run('AgentA'),run('AgentB')]);
    for(const agent of agents){
      assert.equal(agent.code,0);assert.equal(agent.result.ok,true);
      const stored=await readFile(join(agent.home,'session.json'),'utf8');
      assert.ok(!stored.includes(agent.secret));assert.equal(JSON.parse(stored).user_id,agent.result.data.user_id);
    }
    assert.deepEqual(received.map(v=>v.identity).sort(),['AgentA','AgentB']);
    const conflict=await run('AgentC',['--password-stdin']);assert.equal(conflict.code,2);assert.equal(conflict.result.error.code,'INVALID_INPUT');
    assert.equal(received.length,2);
  }finally{server.close();await rm(root,{recursive:true,force:true});}
});
