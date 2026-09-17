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
			// unpdf lives in dist/pdf.js (below), so opening the panel doesn't parse pdf.js.
			external: ['vscode', 'unpdf'],
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
