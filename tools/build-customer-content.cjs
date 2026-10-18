'use strict';

// Compatibility entry point; implementation lives with the content build tools.
const build = require('./content/build-customer-content.cjs');
module.exports = { buildCustomerContent: build.buildCustomerContent };
if (require.main === module) build.runCli();
