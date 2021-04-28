#!/usr/bin/env bash
# Copyright (c) 2016-present Unito Inc.
# All Rights Reserved
#
# Common script for version bumping of a node package from Shippable.

# Fail on first error.
set -e

die() { printf "$*\n" 1>&2; exit 1; }

echo "PULL_REQUEST: $PULL_REQUEST"
echo "BASE_BRANCH: $BASE_BRANCH"
echo "BRANCH: $BRANCH"
echo "HEAD_BRANCH: $HEAD_BRANCH"
echo "COMMIT_MESSAGE: $COMMIT_MESSAGE"
commit_title=$(echo "$COMMIT_MESSAGE" | head -1)

if [[ $commit_title == *"[skip ci]"* ]]; then
  # We get here in PR test builds because Shippable's [skip ci] flag doesn't work for PR commits.
  # -> We manually check for it & abort. https://github.com/Shippable/support/issues/1787
  echo "Found [skip ci] flag, aborting."
  exit 0
fi

if [[ "$PULL_REQUEST" != "false" && $commit_title == *"[force-build]"* ]]; then
  echo "Commit message contains build-forcing magic keyword; bumping to branch-prefixed prerelease version."
elif  [[ "$PULL_REQUEST" != "false" && $commit_title =~ ^.*\[sandbox[0-9]+\].*$ ]]; then
  echo "Commit message contains sandbox magic keyword; bumping to branch-prefixed prerelease version."
elif ! [[ "$PULL_REQUEST" == "false" || -z "$PULL_REQUEST" ]]; then
  # $PULL_REQUEST is set by Shippable to the PR number if the build is run
  # for a Pull Request. Otherwise, the variable will be set to 'false'.
  echo "Not bumping the version from a Pull Request."
  exit 0
fi

# `npm install` will, for historical reasons, change the lockfile. Reset it.
git checkout -- '*package-lock.json'

if [[ -n $(git status -s) ]]; then
  git status -s
  die "Please make sure your git environment is clean."
fi

# We don't want npm version to commit the version bump, we'll take care of that.
npm config set git-tag-version false

if [[ "$PULL_REQUEST" == 'false' ]]; then
  # In case another merge happens while we were in queue to be processed.
  git pull -q || die "Conflicts merging with origin"

  # Fix PRs specifiying a pre-release package version potentially older than master
  # (caused by [force-build]s in a branch, rebasing, and failing to discard version changes or bump it),
  # which would bump to an already-released version and cause a conflict.
  pkgDiff=$(git diff master:package.json package.json)
  diffPrereleaseRegex='^\+.*"version".*"\d+\.\d+\.\d+-.+\.\d+"'
  prereleaseRegex='\d+\.\d+\.\d+-.+\.\d+'
  if echo "$pkgDiff" | grep -qP "$diffPrereleaseRegex"; then
    prereleaseVersion=$(echo "$pkgDiff" | grep -P "$diffPrereleaseRegex" | grep -oP "$prereleaseRegex")
    echo "Your PR changes the npm package version to pre-release version $prereleaseVersion , which could cause conflicts if version bumps happened since then on master."

    diffInitialVersionRegex='\-.*"version".*"\d+\.\d+\.\d+"'
    initialVersionRegex='\d+\.\d+\.\d+'
    versionToRevertTo=$(echo "$pkgDiff" | grep -P "$diffInitialVersionRegex" | grep -oP "$initialVersionRegex")
    echo "Scrapping pre-release version changes: reverting to master version $versionToRevertTo ..."

    npm version "$versionToRevertTo"
    # ... then normal bumping can proceed
  fi

  echo 'Bumping npm version...'
  new_version=$(npm version patch)
  echo "Bumped to npm version $(npm ls --depth=0 --silent | head -n 1)"
else
  sanitized_branch=$(echo "${HEAD_BRANCH//[\/_]/-}" | tr '[:upper:]' '[:lower:]')
  new_version=$(npm version prerelease --preid="$sanitized_branch")
fi

# [skip ci] is needed, otherwise Shippable will enter a building loop!
# We also disable the pre-commit hooks, since we already tested
# the new version at the moment the version is bumped.
git commit -a -n -m "$new_version [skip ci]" --author="UnitoBot <bot@unito.io>"

git tag "$new_version"
git push --tags origin
if [[ "$PULL_REQUEST" == 'false' ]]; then
  git push origin master
else
  git push origin HEAD:"$HEAD_BRANCH"
fi

echo "Bumped version of the package to $new_version"
