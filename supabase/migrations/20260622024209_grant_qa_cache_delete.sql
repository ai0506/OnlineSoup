-- service_role 此前只有 select/insert/update，缺少 delete，导致管理端删除/清空缓存失败。
grant delete on public.puzzle_qa_cache to service_role;

notify pgrst, 'reload schema';
