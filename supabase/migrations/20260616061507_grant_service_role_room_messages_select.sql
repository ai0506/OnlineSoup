-- room_messages was only ever revoked from anon/authenticated; it was never
-- explicitly granted to service_role. New-style Supabase secret keys (the
-- `sb_secret_...` format) do not implicitly bypass table-level grants the
-- way the legacy service_role JWT did, so the admin client's direct
-- `.from("room_messages").select(...)` read in
-- src/app/rooms/[code]/ask/route.ts (used to build AI prompt context) has
-- been silently failing with "permission denied for table room_messages"
-- in production - the route ignores the select error and falls back to an
-- empty array, so the AI host has effectively never seen recent room
-- context. Grant the missing privilege.
grant select on table public.room_messages to service_role;

notify pgrst, 'reload schema';
