import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks=vi.hoisted(()=>({
  webClient:vi.fn(),candidate:vi.fn(),login:vi.fn(),logout:vi.fn(),approve:vi.fn(),rate:vi.fn(),
  profile:vi.fn(),getUserById:vi.fn(),webUser:vi.fn(),webApprove:vi.fn(),
}));
vi.mock('next/headers',()=>({headers:async()=>new Headers({'x-forwarded-for':'127.0.0.1'})}));
vi.mock('@/lib/env',()=>({getSupabaseEnv:()=>({url:'https://example.supabase.co',publishableKey:'public-test-key'})}));
vi.mock('@supabase/supabase-js',()=>({createClient:mocks.candidate}));
vi.mock('@/lib/supabase/server',()=>({createClient:mocks.webClient}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>({rpc:mocks.rate,from:()=>({select:()=>({ilike:()=>({maybeSingle:mocks.profile})})}),auth:{admin:{getUserById:mocks.getUserById}}})}));

import { approveBrowserLogin, signInForCli } from '@/app/auth/cli/actions';

const id='11111111-1111-4111-8111-111111111111';
const cliUser='22222222-2222-4222-8222-222222222222';
const webUser='33333333-3333-4333-8333-333333333333';
function form(identity='other@example.com') {
  const data=new FormData();
  Object.entries({id,identity,password:'test-password',code:'ABCD-EFGH'}).forEach(([key,value])=>data.set(key,value));
  return data;
}
describe('CLI browser authorization account isolation',()=>{
  beforeEach(()=>{
    vi.resetAllMocks();
    vi.stubEnv('SUPABASE_SECRET_KEY','test-secret');
    mocks.candidate.mockReturnValue({auth:{signInWithPassword:mocks.login,signOut:mocks.logout},rpc:mocks.approve});
    mocks.webClient.mockResolvedValue({auth:{getUser:mocks.webUser},rpc:mocks.webApprove});
    mocks.webUser.mockResolvedValue({data:{user:{id:webUser}}});
    mocks.rate.mockResolvedValue({error:null});
    mocks.login.mockResolvedValue({error:null,data:{user:{id:cliUser}}});
    mocks.approve.mockResolvedValue({error:null,data:{status:'approved'}});
    mocks.webApprove.mockResolvedValue({error:null,data:{status:'approved'}});
    mocks.logout.mockResolvedValue({error:null});
  });
  it('authorizes a different account without reading or replacing the web session',async()=>{
    await expect(signInForCli({message:''},form())).rejects.toMatchObject({digest:`NEXT_REDIRECT;replace;/auth/cli?id=${id};307;`});
    expect(mocks.webClient).not.toHaveBeenCalled();
    expect(mocks.candidate).toHaveBeenCalledWith('https://example.supabase.co','public-test-key',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    expect(mocks.approve).toHaveBeenCalledWith('approve_cli_browser_login',{p_id:id,p_code:'ABCD-EFGH',p_approve:true,p_expected_web_user:cliUser});
    // Revoking this session now would break the terminal's later issuance check.
    expect(mocks.logout).not.toHaveBeenCalled();
  });
  it('resolves a username but approves only the user returned by authentication',async()=>{
    mocks.profile.mockResolvedValue({data:{id:cliUser},error:null});
    mocks.getUserById.mockResolvedValue({data:{user:{email:'other@example.com'}}});
    await expect(signInForCli({message:''},form('Other'))).rejects.toHaveProperty('digest');
    expect(mocks.login).toHaveBeenCalledWith({email:'other@example.com',password:'test-password'});
    expect(mocks.webClient).not.toHaveBeenCalled();
  });
  it('requires a terminal code before creating any session',async()=>{
    const input=form();input.delete('code');
    expect((await signInForCli({message:''},input)).message).toContain('8 位验证码');
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.rate).not.toHaveBeenCalled();
  });
  it('does not approve on incorrect credentials or exceed the password rate limit',async()=>{
    mocks.login.mockResolvedValue({error:{message:'invalid'},data:{user:null}});
    expect((await signInForCli({message:''},form())).message).toBe('账号或密码不正确。');
    expect(mocks.approve).not.toHaveBeenCalled();
    mocks.login.mockClear();mocks.rate.mockResolvedValue({error:{message:'RATE_LIMITED'}});
    expect((await signInForCli({message:''},form())).message).toContain('频繁');
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.webClient).not.toHaveBeenCalled();
  });
  it.each(['wrong_code','wrong_account','expired','failed'])('cleans up the temporary session after %s',async(status)=>{
    mocks.approve.mockResolvedValue({error:null,data:{status}});
    expect((await signInForCli({message:''},form())).message).not.toBe('');
    expect(mocks.logout).toHaveBeenCalledWith({scope:'local'});
    expect(mocks.webClient).not.toHaveBeenCalled();
  });
  it('keeps current-account approval bound to the authenticated web user',async()=>{
    const input=form();input.set('user',webUser);
    await expect(approveBrowserLogin({message:''},input)).rejects.toHaveProperty('digest');
    expect(mocks.webApprove).toHaveBeenCalledWith('approve_cli_browser_login',{p_id:id,p_code:'ABCD-EFGH',p_approve:true,p_expected_web_user:webUser});
    expect(mocks.candidate).not.toHaveBeenCalled();
  });
  it('keeps cancellation on the web session without creating another login',async()=>{
    const input=form();input.set('user',webUser);input.set('intent','deny');
    mocks.webApprove.mockResolvedValue({error:null,data:{status:'denied'}});
    await expect(approveBrowserLogin({message:''},input)).rejects.toHaveProperty('digest');
    expect(mocks.webApprove).toHaveBeenCalledWith('approve_cli_browser_login',expect.objectContaining({p_approve:false}));
    expect(mocks.candidate).not.toHaveBeenCalled();
  });
});
