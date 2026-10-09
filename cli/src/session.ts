import { constants } from 'node:fs';
import { open,mkdir,chmod,lstat,rename } from 'node:fs/promises';
import { homedir,hostname } from 'node:os';
import { join,resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tryLock,unlock } from 'fs-native-extensions';
import type { Checkpoint } from './sync.js';
import { CookieJar } from 'tough-cookie';
export type Pending={key:string;action:string;room:string;payload:Record<string,unknown>;password_required?:boolean;created_at:number;user_id?:string};
export type State={origin:string;user_id?:string;username?:string;room?:string;pending:Record<string,Pending>;browser_login?:{id:string;secret:string;verifier:string;user_code:string;expires_at:number};sync?:Record<string,Checkpoint>;jar?:ReturnType<CookieJar['serializeSync']>};
async function secure(path:string,directory=false) {
  const stat=await lstat(path);if(stat.isSymbolicLink() || (directory?!stat.isDirectory():!stat.isFile()))throw new Error('UNSAFE_SESSION_FILE');
  if(process.platform==='win32') {
    const identity=execFileSync('whoami',[],{encoding:'utf8'}).trim();
    execFileSync('icacls',[path,'/inheritance:r','/grant:r',`${identity}:${directory?'(OI)(CI)F':'F'}`],{stdio:'ignore'});
  } else {
    if(stat.uid!==process.getuid?.())throw new Error('UNSAFE_SESSION_FILE');
    await chmod(path,directory?0o700:0o600);
  }
}
export async function openSession(origin:string) {
  const home=resolve(process.env.ONLINESOUP_HOME??join(homedir(),'.onlinesoup'));
  await mkdir(home,{recursive:true,mode:0o700});await secure(home,true);
  const lock=await open(join(home,'session.lock'),constants.O_RDWR|constants.O_CREAT|constants.O_NOFOLLOW,0o600);
  await secure(join(home,'session.lock'));
  if(!tryLock(lock.fd)){await lock.close();throw new Error('LOCAL_SESSION_BUSY');}
  await lock.truncate(0);await lock.writeFile(JSON.stringify({pid:process.pid,hostname:hostname(),started_at:new Date(Date.now()-process.uptime()*1000).toISOString(),acquired_at:new Date().toISOString()}));
  const file=join(home,'session.json');
  let state:State={origin,pending:{}};
  try {
    const reader=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{await secure(file);state=JSON.parse(await reader.readFile('utf8'));}finally{await reader.close();}
    if(state.origin!==origin)throw new Error('SESSION_ORIGIN_MISMATCH');
  }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT'){unlock(lock.fd);await lock.close();throw e;}}
  const jar=state.jar?CookieJar.deserializeSync(state.jar):new CookieJar();
  async function save() {
    // The server retains expired-key tombstones; unresolved writes remain recoverable for seven days.
    for(const [key,request] of Object.entries(state.pending)) {
      if(request.created_at<Date.now()-7*24*60*60*1000)delete state.pending[key];
    }
    state.jar=jar.serializeSync();
    const temporary=join(home,`session-${randomUUID()}.tmp`);
    const writer=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{await writer.writeFile(JSON.stringify(state));await writer.sync();}finally{await writer.close();}
    await secure(temporary);await rename(temporary,file);
  }
  return {state,jar,save,async close(){unlock(lock.fd);await lock.close();}};
}
