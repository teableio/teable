#!/bin/bash

# The following is a script to clean up after a Docker build is completed,
# which is intended for use in a CI/CD environment to remove unnecessary artifacts.

# Delete Next build cache
rm -fr /app/apps/nextjs-app/.next/cache || { echo "Next build cache does not exist."; exit 1; }

# Define the root directory
root_dir="/app/packages"

# Define an array containing the files and directories to keep
declare -a keep_list=("dist" "node_modules" "package.json" "prisma" ".env" "ecosystem.config.js")

# Navigate to the root directory; exit if the directory does not exist
cd "$root_dir" || { echo "Directory $root_dir does not exist."; exit 1; }

# Loop through each subdirectory under the root directory
for dir in ./*/; do
  # Check if it's a directory
  if [ -d "$dir" ]; then
    cd "$dir" || { echo "Cannot enter directory $dir"; exit 1; }

    # Loop through all items in the current subdirectory, including hidden ones
    for item in $(ls -A); do

      # Initialize the keep flag to false
      keep=false

      # Check if the current item is in the keep_list
      for keep_item in "${keep_list[@]}"; do
        if [[ "$item" == "$keep_item" ]]; then
          keep=true
          break
        fi
      done

      # If the item is not in the keep_list, prepare to delete and output its full path
      if [ "$keep" == "false" ]; then
        full_path="$(pwd)/$item"
        echo "Preparing to delete: $full_path"
        rm -rf "$item"
      fi
    done

    cd -
  fi
done




