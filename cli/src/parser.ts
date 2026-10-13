export type Command = {name:string; text:string; options:Record<string,string|boolean>};
const names=new Set(['help','login','logout','join','leave','state','room','facts','seats','points','wait','puzzle','say','ask','hint','reason','messages','request','exit']);
// Shell argv is already tokenized; interactive text uses the same token parser.
export function tokenize(line:string):string[] {
  const result:string[]=[];let word='',quote='';let active=false;
  for(let i=0;i<line.length;i++) {
    const c=line[i];
    if(c==='\\' && (line[i+1]==='"'||line[i+1]==="'"||line[i+1]==='\\')){word+=line[++i];active=true;continue;}
    if(quote){if(c===quote)quote='';else word+=c;active=true;continue;}
    if((c==='"'||c==="'")&&!active){quote=c;active=true;continue;}
    if(/\s/.test(c)){if(active){result.push(word);word='';active=false;}}else{word+=c;active=true;}
  }
  if(quote)throw new Error('INVALID_INPUT');if(active)result.push(word);return result;
}
export function inputErrorDetail(error:unknown):string|undefined {
  return (error as {detail?:string})?.detail;
}
function unknownOption(arg:string):Error {
  // PowerShell drops a bare -- before a script such as soup.ps1, so literal text arrives as an option.
  const hint=/\s/.test(arg)?'；若这是要发送的文字：在 PowerShell 中单独的 -- 会被去掉，请改用 soup.cmd 执行':'';
  return Object.assign(new Error('INVALID_INPUT'),{detail:`未知选项：${arg}${hint}`});
}
export function parse(args:string[]):Command {
  if(!args.length)return {name:'help',text:'',options:{}};
  const first=args[0];
  if(first.startsWith('//'))return {name:'say',text:[first.slice(1),...args.slice(1)].join(' '),options:{}};
  if(!first.startsWith('/'))return {name:'say',text:args.join(' '),options:{}};
  const rawName=first.slice(1).toLowerCase();const name=rawName==='room'?'state':rawName;if(!names.has(name))throw new Error('INVALID_COMMAND');
  const flags:Record<string,string[]>= {login:['browser','no-browser','wait','credentials-file'],join:['takeover','request-key'],ask:['use-personal-points','request-key'],hint:['use-personal-points','request-key'],reason:['use-personal-points','request-key'],say:['request-key'],leave:['request-key'],messages:['after','before','limit','reset','cached'],wait:['timeout']};
  const options:Record<string,string|boolean>={}, words:string[]=[];let literal=false;
  for(let i=1;i<args.length;i++) {
    const arg=args[i];if(arg==='--'&&!literal){literal=true;continue;}
    if(!literal&&arg.startsWith('--')) {
      const key=arg.slice(2);if(!flags[name]?.includes(key))throw unknownOption(arg);
      if(['browser','no-browser','wait','takeover','use-personal-points','reset','cached'].includes(key))options[key]=true;
      else{if(args[i+1]===undefined||args[i+1].startsWith('--'))throw new Error('REQUIRED_INPUT_MISSING');options[key]=args[++i];}
    }else words.push(arg);
  }
  return {name,text:words.join(' '),options};
}

export function parseLine(line:string):Command { return parse(line.startsWith("/")?tokenize(line):[line]); }
