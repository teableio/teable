#!/usr/bin/env bash
set -Eeo pipefail

if [ "$(id -u)" = '0' ]; then
  # Set the correct permission for local cache
  find /app/.assets \! -user nodejs -exec chown nodejs '{}' +
  find /app/.temporary \! -user nodejs -exec chown nodejs '{}' +

  # then restart script as nodejs user
  exec gosu nodejs "$BASH_SOURCE" "$@"
fi

exec "$@"
