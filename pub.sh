set -ex
npm run clean
npm install
npm run prepare:packages
npm run prerelease:dev
npm run build
npm publish --workspaces --tag rc --access public
