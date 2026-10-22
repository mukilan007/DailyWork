-- Same twelve-state status set for todo spaces (2026-10-22).
--
-- Brings todo spaces onto the vocabulary the work log now uses. Per-space
-- statuses are user-editable, so this ONLY rewrites spaces still carrying the
-- untouched original seed — any space whose states have been customised is
-- left exactly as it is.
--
-- Todos referencing the old keys are remapped in the same transaction so no
-- ticket is left pointing at a state its space no longer defines:
--
--   todo      -> open          done      -> completed
--   blocked   -> on_hold       cancelled -> closed
--   in_progress                          (unchanged)
--
-- `is_done` stays consistent: done/cancelled were terminal and map to
-- completed/closed, which are terminal too; blocked was not and on_hold is not.

-- New default for spaces created from here on.
alter table public.todo_spaces
  alter column statuses set default
    '[{"key":"open","label":"Open","color":"#94a3b8"},
      {"key":"in_progress","label":"In progress","color":"#3b82f6"},
      {"key":"review","label":"Review","color":"#6366f1"},
      {"key":"fixed_in_developer","label":"Fixed in developer","color":"#0ea5e9"},
      {"key":"validation","label":"Validation","color":"#14b8a6"},
      {"key":"fixed","label":"Fixed","color":"#10b981","done":true},
      {"key":"not_an_issue","label":"Not an issue","color":"#6b7280","done":true},
      {"key":"later","label":"Later","color":"#8b5cf6"},
      {"key":"not_reproduced","label":"Not reproduced","color":"#64748b","done":true},
      {"key":"completed","label":"Completed","color":"#22c55e","done":true},
      {"key":"closed","label":"Closed","color":"#475569","done":true},
      {"key":"on_hold","label":"On hold","color":"#f59e0b"}]'::jsonb;

-- Only spaces whose status keys still match the original seed, in order.
update public.todo_spaces
set statuses =
    '[{"key":"open","label":"Open","color":"#94a3b8"},
      {"key":"in_progress","label":"In progress","color":"#3b82f6"},
      {"key":"review","label":"Review","color":"#6366f1"},
      {"key":"fixed_in_developer","label":"Fixed in developer","color":"#0ea5e9"},
      {"key":"validation","label":"Validation","color":"#14b8a6"},
      {"key":"fixed","label":"Fixed","color":"#10b981","done":true},
      {"key":"not_an_issue","label":"Not an issue","color":"#6b7280","done":true},
      {"key":"later","label":"Later","color":"#8b5cf6"},
      {"key":"not_reproduced","label":"Not reproduced","color":"#64748b","done":true},
      {"key":"completed","label":"Completed","color":"#22c55e","done":true},
      {"key":"closed","label":"Closed","color":"#475569","done":true},
      {"key":"on_hold","label":"On hold","color":"#f59e0b"}]'::jsonb
where (
  select array_agg(elem->>'key' order by ord)
  from jsonb_array_elements(statuses) with ordinality as t(elem, ord)
) = array['todo', 'in_progress', 'done', 'blocked', 'cancelled'];

-- Remap todos that belong to a space we just rewrote, plus Inbox todos
-- (space_id null — the Inbox has no row and takes its states from the app).
with rewritten as (
  select id from public.todo_spaces
  where (
    select array_agg(elem->>'key' order by ord)
    from jsonb_array_elements(statuses) with ordinality as t(elem, ord)
  ) = array['open', 'in_progress', 'review', 'fixed_in_developer', 'validation',
            'fixed', 'not_an_issue', 'later', 'not_reproduced', 'completed',
            'closed', 'on_hold']
)
update public.todos
set status = case status
               when 'todo' then 'open'
               when 'done' then 'completed'
               when 'blocked' then 'on_hold'
               when 'cancelled' then 'closed'
               else status
             end
where status in ('todo', 'done', 'blocked', 'cancelled')
  and (space_id is null or space_id in (select id from rewritten));

-- Default for new todos follows the new first state.
alter table public.todos
  alter column status set default 'open';
