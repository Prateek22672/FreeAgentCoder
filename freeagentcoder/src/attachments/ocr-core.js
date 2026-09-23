'use strict';

// The OCR engine is WebAssembly, about 2.8 MB, and is downloaded once on first
// use instead of being shipped in the extension. The build points every
// `tesseract.js-core/...` import inside the worker at this file, and the path
// of the downloaded engine reaches the worker thread through the environment.
const corePath = process.env.FREEAGENTCODER_OCR_CORE;
if (!corePath) {
    throw new Error('The text reader was started without a path to its engine.');
}
module.exports = require(corePath);
