#!/usr/bin/env bash

# Exit if PULL_REQUEST is true or else publish
[[ "$PULL_REQUEST" == "true" ]] || npm run publish-to-npm
