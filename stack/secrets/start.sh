#!/bin/sh
# Reads one stack service's local keys from the memory volume and starts the image's own program
# (priitkustala/ai-news#92). Usage: start.sh <file in the memory folder> <program> [arguments...].
# The values reach the program only through its environment: never an argument, never set -x.
f=/run/ai-news-secrets/$1
shift
[ -s "$f" ] || { echo "start: $f is absent; the stack's keys are gone (run node dist/cli.js keys in the box, then step 7)" >&2; exit 1; }
set -a
. "$f"
set +a
exec "$@"
