grant select on table public.profiles to service_role;
grant update (points, updated_at) on table public.profiles to service_role;

notify pgrst, 'reload schema';
