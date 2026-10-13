import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {CookieJar} from 'tough-cookie';
import {api,closeConnections} from '../dist/cli/src/api-client.js';

test('authentication cookies, identity and cache boundary are saved together',async()=>{
  let response={api_version:1,ok:true,error:null,data:{authenticated:true,user_id:'account-b',username:'PlayerB'}};
  const server=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Set-Cookie','sb-auth=new-account; Path=/');res.end(JSON.stringify(response));});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;
  function fixture(){
    const snapshots=[],jar=new CookieJar();jar.setCookieSync('sb-auth=old-account; Path=/',origin);
    const s={state:{origin,user_id:'account-a',username:'PlayerA',room:'ABCDEF',sync:{'account-a:ABCDEF':{messages:[{content:'private A'}]}},pending:{}},jar,
      save:async()=>snapshots.push({state:structuredClone(s.state),cookie:jar.getCookieStringSync(origin)})};
    return {s,snapshots};
  }
  try{
    for(const path of ['/login','/browser-login/poll']){
      response.data={authenticated:true,user_id:'account-b',username:'PlayerB',...(path.includes('poll')?{status:'completed'}:{})};
      const {s,snapshots}=fixture();assert.equal((await api(s,path,{})).ok,true);
      assert.equal(snapshots.length,1);assert.equal(snapshots[0].state.user_id,'account-b');
      assert.equal(snapshots[0].state.room,undefined);assert.equal(snapshots[0].state.sync,undefined);
      assert.match(snapshots[0].cookie,/new-account/);
    }
    response.data={authenticated:true};
    const malformed=fixture();assert.equal((await api(malformed.s,'/login',{})).error.code,'REQUEST_RESULT_UNKNOWN');
    assert.equal(malformed.snapshots.length,0);assert.match(malformed.s.jar.getCookieStringSync(origin),/old-account/);
    response={api_version:1,ok:false,data:null,error:{code:'INVALID_CREDENTIALS',message:'invalid',retryable:false}};
    const denied=fixture();assert.equal((await api(denied.s,'/login',{})).ok,false);
    assert.equal(denied.snapshots.length,0);assert.match(denied.s.jar.getCookieStringSync(origin),/old-account/);
    response={api_version:1,ok:true,error:null,data:{authenticated:false}};
    const logout=fixture();assert.equal((await api(logout.s,'/logout',{})).ok,true);
    assert.equal(logout.snapshots.length,1);assert.equal(logout.snapshots[0].state.user_id,undefined);
    assert.equal(logout.snapshots[0].state.sync,undefined);
  }finally{server.close();await closeConnections();}
});
