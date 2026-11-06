#!/bin/sh
# Renders the gateway configuration with this stack's local keys (from the memory volume, exported by
# ../secrets/start.sh; priitkustala/ai-news#92) into the container's own memory filesystem and starts Envoy. No key
# on a command line: the substitutions go through a sed script in memory, removed after the render.
# Keys are base64url or JWT strings: no `|` can occur in them.
set -eu
umask 077
for name in PUBLISHABLE_KEY SECRET_KEY ANON_JWT SERVICE_ROLE_JWT; do
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "entrypoint: $name is not set; run 'node dist/cli.js keys' in the backend box" >&2
    exit 1
  fi
done
script=/dev/shm/envoy.sed
{
  printf 's|@PUBLISHABLE_KEY@|%s|g\n' "$PUBLISHABLE_KEY"
  printf 's|@SECRET_KEY@|%s|g\n' "$SECRET_KEY"
  printf 's|@ANON_JWT@|%s|g\n' "$ANON_JWT"
  printf 's|@SERVICE_ROLE_JWT@|%s|g\n' "$SERVICE_ROLE_JWT"
} > "$script"
sed -f "$script" /stack/envoy/envoy.template.yaml > /dev/shm/envoy.yaml
rm -f "$script"
exec envoy -c /dev/shm/envoy.yaml --log-level warn
