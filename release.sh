#!/bin/bash
# Releases a new version of the BRAT fork for the tar.gz install flow this
# very plugin implements (see /home/jrparra/git/MonoParra/PACKAGE.md):
#   1. bumps package.json (BARE x.y.z), manifest.json + versions.json (v-PREFIXED)
#   2. runs the CI gates (type-check, lint, test) and builds dist/
#      (which emits obsidian42-brat-v<version>.tar.gz)
#   3. commits the bump, tags it with the V-PREFIXED version (BRAT matches
#      release tag_name === manifest.version, and this repo's manifest carries
#      the "v", unlike the sibling plugins) and pushes
#   4. creates the GitHub release with the tarball plus loose
#      main.js/manifest.json/styles.css as a classic-flow fallback
#
# NOTE: normal releases go through CI (.github/workflows/release.yml runs
# release-please on pushes to main). This script is the manual escape hatch
# for cutting a release locally; after using it, expect release-please to
# open a follow-up release PR for any later conventional commits.
set -euo pipefail
cd "$(dirname "$0")"

usage() {
  echo "Usage: $0 [patch|minor|major|<version>]"
  echo "  patch|minor|major  bump the package.json version (default: patch)"
  echo "  <version>          explicit version, e.g. 2.4.0 (no leading v)"
  echo ""
  echo "Env: SKIP_TESTS=1 to skip the type-check/lint/test gates,"
  echo "     ALLOW_BRANCH=1 to release off main"
  exit 1
}

BUMP="${1:-patch}"
case "$BUMP" in -h|--help) usage ;; esac

# --- preflight ---------------------------------------------------------------
command -v gh >/dev/null 2>&1 || { echo "error: GitHub CLI (gh) is required"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "error: pnpm is required"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "error: gh is not authenticated (gh auth login)"; exit 1; }

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "error: working tree is not clean, commit or stash first"
  exit 1
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ] && [ "${ALLOW_BRANCH:-}" != "1" ]; then
  echo "error: on branch '$BRANCH' — BRAT reads manifest.json from the default"
  echo "branch HEAD, so releases must go out from main (ALLOW_BRANCH=1 to override)"
  exit 1
fi

# Sync with the remote BEFORE deciding anything: this repo's CI (release-please)
# cuts releases of its own on pushes to main — it creates the tag AND commits a
# version bump — so a stale local checkout would otherwise happily build a
# release whose tag/push is rejected at the very last step.
echo "Fetching origin..."
git fetch --tags --prune origin

UPSTREAM="origin/$BRANCH"
if git rev-parse -q --verify "refs/remotes/$UPSTREAM" >/dev/null; then
  BEHIND=$(git rev-list --count "HEAD..$UPSTREAM")
  if [ "$BEHIND" -ne 0 ]; then
    echo "error: local $BRANCH is $BEHIND commit(s) behind $UPSTREAM"
    echo "run 'git pull --rebase' first (CI commits version bumps to main)"
    exit 1
  fi
fi

# package.json holds the BARE version; manifest.json/versions.json/tags carry
# a leading "v" (version-bump.mjs establishes this convention).
CURRENT=$(node -p "require('./package.json').version")
PLUGIN_ID=$(node -p "require('./manifest.json').id")

case "$BUMP" in
  patch|minor|major)
    NEW_VERSION=$(node -e "
      const [ma, mi, pa] = '$CURRENT'.split('.').map(Number);
      const out = { major: [ma+1,0,0], minor: [ma,mi+1,0], patch: [ma,mi,pa+1] };
      console.log(out['$BUMP'].join('.'));
    ")
    ;;
  *)
    echo "$BUMP" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || {
      echo "error: '$BUMP' is not patch/minor/major or a bare x.y.z version"
      usage
    }
    NEW_VERSION="$BUMP"
    ;;
esac

TAG="v$NEW_VERSION"

# the fetch above brought down remote tags, so this covers both local tags and
# ones CI already published (the case that used to fail only at push time,
# after the whole build had run)
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "error: tag $TAG already exists"
  echo "if CI (release-please) already released it, that version is done —"
  echo "pick a higher version, or upload assets to the existing release with:"
  echo "  gh release upload $TAG dist/${PLUGIN_ID}-$TAG.tar.gz"
  exit 1
fi

echo "Releasing $CURRENT -> $NEW_VERSION (tag $TAG)"

# --- install deps + gates (before touching any version files) ----------------
echo "Installing dependencies..."
pnpm install --frozen-lockfile

if [ "${SKIP_TESTS:-}" != "1" ]; then
  # same gates the release workflow runs
  echo "Type checking..."
  pnpm run type-check
  echo "Linting..."
  pnpm run lint
  echo "Running tests..."
  pnpm run test
fi

# --- bump version files ------------------------------------------------------
# from here until the release commit, revert the bump on any failure (including
# explicit exit 1, which ERR traps miss) so the working tree stays clean
BUMPED=0
cleanup() {
  local status=$?
  if [ "$status" -ne 0 ] && [ "$BUMPED" -eq 1 ]; then
    echo "error: release failed, reverting version bump"
    git checkout -- manifest.json package.json versions.json
  fi
}
trap cleanup EXIT
BUMPED=1
# each file keeps its own indentation; manifest.json + versions.json take the
# v-prefixed version (what BRAT compares against the release tag), package.json
# the bare one (what esbuild.config.mjs reads via npm_package_version)
node - "$NEW_VERSION" <<'EOF'
const fs = require("fs");
const version = process.argv[2];

const rewrite = (file, mutate) => {
  const text = fs.readFileSync(file, "utf8");
  const indent = /\n(\s+)/.exec(text)?.[1] ?? "\t";
  const json = JSON.parse(text);
  mutate(json);
  fs.writeFileSync(file, JSON.stringify(json, null, indent) + "\n");
};

rewrite("package.json", (p) => { p.version = version; });
rewrite("manifest.json", (m) => { m.version = `v${version}`; });

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
rewrite("versions.json", (v) => { v[`v${version}`] = manifest.minAppVersion; });
EOF

# --- build (after the bump: the build stamps dist/manifest.json from
# --- package.json's version via npm_package_version) -------------------------
echo "Building dist/..."
pnpm run build

# --- verify the tarball the fork will install --------------------------------
TARBALL="dist/${PLUGIN_ID}-${TAG}.tar.gz"
[ -f "$TARBALL" ] || { echo "error: build did not produce $TARBALL"; exit 1; }

# list once into a variable: piping tar into grep -q makes tar fail with
# SIGPIPE under pipefail when grep exits at the first match
TARBALL_LISTING=$(tar -tzf "$TARBALL")
for required in main.js manifest.json styles.css; do
  grep -qx "$required" <<< "$TARBALL_LISTING" || {
    echo "error: $TARBALL is missing $required at the archive root"
    exit 1
  }
done

# the packaged manifest AND the repo-root manifest must both read v<version>:
# BRAT validates the repo from the root manifest on the default branch, then
# installs whatever the release asset contains
TARBALL_VERSION=$(tar -xzOf "$TARBALL" manifest.json | node -p "JSON.parse(fs.readFileSync(0)).version")
[ "$TARBALL_VERSION" = "$TAG" ] || {
  echo "error: tarball manifest version ($TARBALL_VERSION) != $TAG"
  exit 1
}
ROOT_VERSION=$(node -p "require('./manifest.json').version")
[ "$ROOT_VERSION" = "$TAG" ] || {
  echo "error: root manifest version ($ROOT_VERSION) != $TAG"
  exit 1
}

# the bundle must stay free of BUNDLE-LEVEL Node builtins — Obsidian mobile
# has no Node runtime, so an externalized require("zlib")/require("fs") breaks
# the plugin there. window.require(...) is Obsidian's desktop escape hatch
# (src/utils/logging.ts uses it behind Platform.isDesktop) and is fine.
node - <<'EOF'
const fs = require("fs");
const bundle = fs.readFileSync("dist/main.js", "utf8");
const pattern =
  /(?<![\w.])require\("(zlib|fs|path|crypto|http|https|stream|util|os|child_process)"\)/g;
const hits = [...new Set([...bundle.matchAll(pattern)].map((m) => m[1]))];
if (hits.length > 0) {
  console.error(`error: dist/main.js bundles Node builtins: ${hits.join(", ")}`);
  console.error("Obsidian mobile has no Node runtime — use window.require behind Platform.isDesktop");
  process.exit(1);
}
EOF

# --- commit, tag, push -------------------------------------------------------
git add manifest.json package.json versions.json
git commit -m "chore: release $TAG"
BUMPED=0
git tag "$TAG"
# --atomic: never leave the branch pushed but the tag rejected (or vice versa)
git push --atomic origin HEAD "$TAG"

# --- github release ----------------------------------------------------------
# the tarball is what this fork installs; the loose files are the fallback for
# stock BRAT clients (which only fetch main.js/manifest.json/styles.css)
echo "Creating GitHub release $TAG..."
gh release create "$TAG" \
  "$TARBALL" \
  dist/main.js \
  dist/manifest.json \
  dist/styles.css \
  --title "Release $TAG" \
  --notes "Release $TAG"

echo "Released $TAG successfully!"
