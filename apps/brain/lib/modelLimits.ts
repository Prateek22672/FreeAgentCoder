/**
 * Longest reply asked of a model. A whole designed page runs past 8K tokens,
 * and Gemini answers up to 64K, so it gets room for one; the rest keep 8K.
 */
export function outputTokens(provider: string): number {
    return provider === 'gemini' ? 16_384 : 8_192;
}
