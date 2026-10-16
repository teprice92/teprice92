#!/usr/bin/env bash
# Packages the app for publishing as a Claude artifact: the page body without its
# <html>/<head>/<body> wrapper (the artifact host adds its own) plus the files it loads.
#   scripts/build-artifact.sh <out-dir>
set -euo pipefail
cd "$(dirname "$0")/.."
out="${1:?usage: build-artifact.sh <out-dir>}"
mkdir -p "$out/data"
cp styles.css app.js audio.js questions.js "$out/"
cp data/packs.js "$out/data/"
grep -vE '^<!doctype html>$|^<html lang="en">$|^</?head>$|^</?body>$|^</html>$|<meta charset|name="viewport"' index.html > "$out/trivia-night-trainer.html"
echo "Built $out/trivia-night-trainer.html"
