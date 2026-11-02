#!/bin/sh
# Renders the gateway configuration with this stack's local keys (from the git-ignored
# .env.stack-api, passed in by compose) and starts Envoy. The rendered file lives only
# inside the container. Keys are base64url or JWT strings: no `|` can occur in them.
set -eu
for name in PUBLISHABLE_KEY SECRET_KEY ANON_JWT SERVICE_ROLE_JWT; do
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "entrypoint: $name is not set; run 'node dist/cli.js keys' in the backend box" >&2
    exit 1
  fi
done
sed -e "s|@PUBLISHABLE_KEY@|${PUBLISHABLE_KEY}|g" \
    -e "s|@SECRET_KEY@|${SECRET_KEY}|g" \
    -e "s|@ANON_JWT@|${ANON_JWT}|g" \
    -e "s|@SERVICE_ROLE_JWT@|${SERVICE_ROLE_JWT}|g" \
    /stack/envoy/envoy.template.yaml > /tmp/envoy.yaml
exec envoy -c /tmp/envoy.yaml --log-level warn
