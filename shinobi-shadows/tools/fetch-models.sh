#!/usr/bin/env bash
# Downloads the Higgsfield-generated, auto-rigged character models into assets/models/.
# Run from the shinobi-shadows folder:  bash tools/fetch-models.sh
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p assets/models
BASE=https://d8j0ntlcm91z4.cloudfront.net/user_3F3kQmi11cKqi7WdSoOxdUMXWue
fetch() { echo "Downloading $1"; curl -fSL --retry 3 -o "assets/models/$1.glb" "$BASE/$2.glb"; }
fetch hayate  hf_20261019_220024_18336cf0-22d7-49fe-b279-47faec04da10
fetch raiden  hf_20261019_220026_22acfde6-08f7-457d-8f85-4b42ff340e38
fetch tsubaki hf_20261019_220027_91163ff7-19ed-4c4e-86ca-03d4b5099066
fetch kagero  hf_20261019_220028_7534aa20-6051-45b0-9421-8ff6bade5167
fetch guard   hf_20261019_220030_b6abfcb5-e095-4771-894a-9089a7dfdb7d
fetch elite   hf_20261019_220031_c2d087f6-46b1-44fa-9687-65ec2e97fac9
echo "Done. Reload the game to use the 3D models."
