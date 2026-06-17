-- Update handle_new_user trigger to support custom initial_points from user metadata.
-- Admin-created no-email accounts pass initial_points in raw_user_meta_data.
-- Regular signups default to 100 points.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text :=
    nullif(trim(new.raw_user_meta_data ->> 'username'), '');
  initial_points integer :=
    coalesce(
      nullif(new.raw_user_meta_data ->> 'initial_points', '')::integer,
      100
    );
begin
  if requested_username is null
    or requested_username !~ '^[A-Za-z0-9_]{3,8}$'
  then
    raise exception 'invalid_username';
  end if;

  if initial_points < 0 or initial_points > 1000000000 then
    initial_points := 100;
  end if;

  insert into public.profiles (id, display_name, username, points)
  values (new.id, requested_username, requested_username, initial_points);

  insert into public.points_transactions (
    user_id,
    type,
    amount,
    balance_after
  )
  values (
    new.id,
    'signup_bonus',
    initial_points,
    initial_points
  );

  return new;
exception
  when unique_violation then
    raise exception 'username_taken';
end;
$$;

notify pgrst, 'reload schema';
