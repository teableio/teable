#!/bin/bash
# Automatic update tablePrompt

input_file="openapi.yaml"
output_file="table.yaml"
target_ts_path='../apps/nextjs-app/src/features/app/components/ai-chat/prompt/createTablePrompt.ts'

if ! command -v yq &> /dev/null; then
  echo "installing yq"
  curl -L https://github.com/mikefarah/yq/releases/download/v4.13.5/yq_darwin_amd64 -o /usr/local/bin/yq
  chmod +x /usr/local/bin/yq
  echo "yq install successfull"
fi

curl -o $input_file http://127.0.0.1:3000/docs-yaml
npx --registry=https://registry.npmmirror.com --yes @redocly/cli split $input_file --outDir ./

yq e \
  '{
     "openapi": .openapi,
     "info": .info,
     "tags": .tags,
     "servers": .servers,
     "paths": {"/api/table": .paths."/api/table", "/api/table/{tableId}/record": .paths."/api/table/{tableId}/record"}
   }' \
  $input_file > $output_file

npx --yes @redocly/cli bundle $output_file -o $output_file

echo "export const CREATE_TABLE_PROMPT = \`" > temp.txt
cat $output_file >> temp.txt
echo "\`;" >> temp.txt
mv temp.txt $target_ts_path

rm -r $input_file $output_file components paths
