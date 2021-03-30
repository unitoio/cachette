#!/usr/bin/env bash

# Exit if PULL_REQUEST is true or else publish
if [[ -n "$PULL_REQUEST" && "$PULL_REQUEST" != "false" ]]; then
  echo "Not publishing the package from a Pull Request."
  exit 0
fi

npm publish
