-- The two views of the exposed schema are read-only (priitkustala/ai-news#40, AC-20). A view
-- that is not automatically updatable fails a write in the rewriter (55000, an HTTP 500 from
-- PostgREST) before any privilege is checked. An INSTEAD OF trigger lets the write reach the
-- privilege check, so a caller without a grant (everyone: no role is granted a write on a
-- view) is refused with 42501 (PostgREST: 401 without a session, 403 with one); the trigger
-- itself refuses any write that passes the check.

create function app_private.refuse_view_write() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  raise exception using errcode = '42501', message = format('%s is read-only', tg_table_name);
end
$$;
revoke all on function app_private.refuse_view_write() from public, anon, authenticated;

create trigger feed_read_only instead of insert or update or delete on public.feed
  for each row execute function app_private.refuse_view_write();
create trigger categories_read_only instead of insert or update or delete on public.categories
  for each row execute function app_private.refuse_view_write();
