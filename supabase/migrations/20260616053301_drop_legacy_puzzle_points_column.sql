-- The puzzles table accumulated two parallel scoring-point columns:
--   `points`     - legacy column written once by an early backfill migration,
--                  never updated again.
--   `key_points` - the column the admin UI (admin_create_puzzle /
--                  admin_update_puzzle) actually reads and writes.
-- The AI game runtime was still reading the stale `points` column, so any
-- scoring point edited or created through the admin UI silently never
-- reached gameplay. Before dropping, copy any data that only exists in
-- `points` into `key_points` so nothing is lost, then drop the legacy column.
update public.puzzles
set key_points = points
where (key_points is null or key_points = '[]'::jsonb)
  and points is not null
  and points <> '[]'::jsonb;

alter table public.puzzles
  drop column if exists points;

notify pgrst, 'reload schema';
