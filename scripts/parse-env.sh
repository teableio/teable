#!/usr/bin/env bash

files=("apps/nextjs-app/.env" "apps/nextjs-app/.env.development" "apps/nextjs-app/.env.development.local")

for file in "${files[@]}"; do
  if [[ -f $file ]]; then
    while IFS='=' read -r key value; do
      # Skip lines starting with #
      if [[ $key == \#* ]]; then
        continue
      fi
      # Check if key is empty to avoid exporting invalid environment variables
      if [[ -n $key ]]; then
        # Use eval to handle values that may contain spaces while removing any quotes
        eval export $key=\"$(echo $value | sed -e 's/^"//' -e 's/"$//')\"
      fi
    done <$file
  fi
done
