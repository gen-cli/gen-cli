set -ex
npm run prepare:packages
npm run prerelease:dev
npm run bundle
npm publish --workspaces --tag rc
