import * as path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        // The editor's API exists only inside VS Code; tests of code that merely imports it get an empty stand-in.
        alias: { vscode: path.resolve(__dirname, 'src/test/vscodeStub.ts') },
    },
    test: {
        include: ['src/**/*.test.ts'],
        testTimeout: 20_000,
    },
});
