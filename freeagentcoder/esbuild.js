const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				if (location) {
					console.error(`    ${location.file}:${location.line}:${location.column}:`);
				}
			});
			console.log('[watch] build finished');
		});
	},
};

/**
 * The OCR engine itself is downloaded on first use, not shipped, so every
 * `tesseract.js-core/...` import inside the worker is pointed at a small shim
 * that loads the downloaded file.
 * @type {import('esbuild').Plugin}
 */
const ocrCorePlugin = {
	name: 'ocr-core',
	setup(build) {
		const shim = require('path').join(__dirname, 'src', 'attachments', 'ocr-core.js');
		build.onResolve({ filter: /^tesseract\.js-core/ }, () => ({ path: shim }));
	},
};

/** @type {import('esbuild').BuildOptions} */
const shared = {
	bundle: true,
	minify: production,
	sourcemap: !production,
	sourcesContent: false,
	logLevel: 'silent',
	plugins: [esbuildProblemMatcherPlugin],
};

async function main() {
	const contexts = await Promise.all([
		// Extension host (Node).
		esbuild.context({
			...shared,
			entryPoints: ['src/extension.ts'],
			format: 'cjs',
			platform: 'node',
			target: 'node20',
			outfile: 'dist/extension.js',
			// unpdf and tesseract.js live in dist/pdf.js and dist/ocr.js (below), so
			// opening the panel parses neither pdf.js nor the text reader.
			external: ['vscode', 'unpdf', 'tesseract.js'],
		}),
		// pdf.js on its own: most of the size, needed only when a PDF is attached.
		esbuild.context({
			...shared,
			entryPoints: ['src/attachments/pdfjs.ts'],
			format: 'cjs',
			platform: 'node',
			target: 'node20',
			outfile: 'dist/pdf.js',
		}),
		// The local text reader, used only when an image is attached.
		esbuild.context({
			...shared,
			entryPoints: ['src/attachments/ocr-engine.ts'],
			format: 'cjs',
			platform: 'node',
			target: 'node20',
			outfile: 'dist/ocr.js',
		}),
		// Its worker thread, which Tesseract runs the recognition in.
		esbuild.context({
			...shared,
			entryPoints: ['node_modules/tesseract.js/src/worker-script/node/index.js'],
			format: 'cjs',
			platform: 'node',
			target: 'node20',
			outfile: 'dist/ocr-worker.js',
			plugins: [...shared.plugins, ocrCorePlugin],
		}),
		// Chat UI (webview). Also emits dist/webview.css from its CSS import.
		esbuild.context({
			...shared,
			entryPoints: ['src/webview/app/main.ts'],
			format: 'iife',
			platform: 'browser',
			target: 'es2022',
			outfile: 'dist/webview.js',
		}),
	]);
	if (watch) {
		await Promise.all(contexts.map((ctx) => ctx.watch()));
	} else {
		await Promise.all(contexts.map((ctx) => ctx.rebuild()));
		await Promise.all(contexts.map((ctx) => ctx.dispose()));
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
