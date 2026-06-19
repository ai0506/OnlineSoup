-- Grant service_role the permissions needed for admin deleteUser cleanup:
-- rooms: needs DELETE (SELECT already granted)
-- room_ai_requests: needs SELECT, UPDATE, DELETE

grant delete on table public.rooms to service_role;
grant select, update, delete on table public.room_ai_requests to service_role;
