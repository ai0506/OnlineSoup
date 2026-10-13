import {constants} from 'node:fs';
import {open} from 'node:fs/promises';

export async function readCredentials(path:string):Promise<{identity:string;password:string}> {
  let file;
  try {
    file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const stat=await file.stat();
    if(!stat.isFile()||stat.size>16384)throw Error();
    if(process.platform!=='win32'&&(stat.uid!==process.getuid?.()||(stat.mode&0o077)!==0)){
      throw Object.assign(new Error('UNSAFE_CREDENTIALS_FILE'),{detail:'账号文件必须归当前用户所有，且仅当前用户可读写；请设置 chmod 600。'});
    }
    const buffer=Buffer.alloc(16385);
    const {bytesRead}=await file.read(buffer,0,buffer.length,0);
    if(bytesRead>16384)throw Error();
    const value:unknown=JSON.parse(buffer.subarray(0,bytesRead).toString('utf8').replace(/^\uFEFF/,''));
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error();
    const fields=value as Record<string,unknown>;
    if(Object.keys(fields).some(key=>!['identity','password'].includes(key))||typeof fields.identity!=='string'||typeof fields.password!=='string')throw Error();
    const identity=fields.identity.trim();
    if(!identity||identity.length>254||fields.password.length<6||fields.password.length>4096)throw Error();
    return {identity,password:fields.password};
  } catch(error) {
    if((error as Error).message==='UNSAFE_CREDENTIALS_FILE')throw error;
    throw Object.assign(new Error('INVALID_CREDENTIALS_FILE'),{detail:'无法读取账号文件；请提供含 identity 和 password 的 UTF-8 JSON 普通文件。'});
  } finally {await file?.close();}
}
