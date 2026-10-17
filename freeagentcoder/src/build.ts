declare const __FAC_BUILT__: string | undefined;

/** When this build was made (set by esbuild; empty in tests), so a test install can be told from the published one. */
export const BUILT_AT: string = typeof __FAC_BUILT__ === 'string' ? __FAC_BUILT__ : '';
