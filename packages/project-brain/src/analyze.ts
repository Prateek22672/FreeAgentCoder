/** Puts the detectors together into the Analysis the dashboard renders. */
import { collectDependencies, detectDatabases, detectFrameworks, detectImportantFiles, detectLanguages, detectPackageManager, detectTesting } from './detect';
import { buildArchitecture, buildTree, classifyAll, countRoles, groupByRole } from './structure';
import type { Analysis, RepoInput, RepoMeta } from './types';

export function analyzeRepository(input: RepoInput, meta: RepoMeta): Analysis {
    const dependencies = collectDependencies(input);
    const roles = classifyAll(input.paths);
    return {
        meta,
        fileCount: input.paths.length,
        readCount: input.files.length,
        totalBytes: input.files.reduce((n, f) => n + f.bytes, 0),
        skipped: input.skipped,
        languages: detectLanguages(input).slice(0, 8),
        frameworks: detectFrameworks(input, dependencies),
        packageManager: detectPackageManager(input),
        databases: detectDatabases(input, dependencies),
        testing: detectTesting(input, dependencies),
        importantFiles: detectImportantFiles(input),
        dependencies,
        tree: buildTree(input.paths),
        roles: countRoles(roles),
        byRole: groupByRole(roles),
        architecture: buildArchitecture(roles),
    };
}
