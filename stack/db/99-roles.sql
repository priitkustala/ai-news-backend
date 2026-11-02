-- Local test environment (priitkustala/ai-news#40): sets the passwords of the roles
-- that Supabase Auth and PostgREST log in with, from this stack's local database
-- password (the git-ignored .env.stack-db; never the hosted project's). Runs once, when
-- the database volume is first initialised, as Supabase's self-hosting roles.sql does.
\set pgpass `echo "$POSTGRES_PASSWORD"`

ALTER USER authenticator WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin WITH PASSWORD :'pgpass';
