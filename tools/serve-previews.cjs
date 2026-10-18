'use strict';

// Compatibility CLI; keep existing development commands working.
const { startPreviewServer } = require('./preview/serve-previews.cjs');
module.exports = { startPreviewServer };
if (require.main === module) startPreviewServer();
