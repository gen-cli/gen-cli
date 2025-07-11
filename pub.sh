set -x
npm run clean
set -eu
npm ci
npm run release:version $1
npm run build:packages
npm run prepare:package
npm publish --workspace=@gen-cli/gen-cli-core --tag latest --access public
npm publish --workspace=@gen-cli/gen-cli --tag latest --access public
