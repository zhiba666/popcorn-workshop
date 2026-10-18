'use strict';

// Compatibility entry point; implementation lives with the asset build tools.
const build = require('./assets/build-game-assets.cjs');
module.exports = { buildAssets: build.buildAssets };
if (require.main === module) build.runCli();
