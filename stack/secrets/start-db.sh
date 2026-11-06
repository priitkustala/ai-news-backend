#!/bin/sh
# Reads the database's local keys from the memory volume and starts the image's own program
# (priitkustala/ai-news#92). Before keys there is no file: a throwaway password, in process memory only, lets
# the first up initialise a database that step 7 then drops. Never an argument, never set -x.
f=/run/ai-news-secrets/stack-db.env
if [ -s "$f" ]; then
  set -a
  . "$f"
  set +a
else
  echo "start: $f is absent; a throwaway password until keys and step 7" >&2
  POSTGRES_PASSWORD=$(od -An -tx1 -N24 /dev/urandom | tr -d ' \n')
  PGPASSWORD=$POSTGRES_PASSWORD
  export POSTGRES_PASSWORD PGPASSWORD
fi
exec "$@"
