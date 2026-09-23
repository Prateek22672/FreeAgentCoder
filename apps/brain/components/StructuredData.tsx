import { DESCRIPTION, GITHUB, MARKETPLACE, PRODUCT, SITE_URL, canonical } from '@/lib/site';

/**
 * Structured data for search engines. Everything here matches what the page
 * says — describing features we do not ship would be both wrong and, for
 * Google, a reason to distrust the markup.
 */
export function StructuredData({ data }: { data: object | object[] }) {
    return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}

export const organization = {
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: 'Kodenza',
    url: SITE_URL,
    sameAs: [GITHUB],
};

export const website = {
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    url: SITE_URL,
    name: PRODUCT,
    // People search both spellings; claim the brand for each.
    alternateName: ['Free Agent Coder', 'FreeAgentCoder', 'Free Agent Coder VS Code extension'],
    description: DESCRIPTION,
    publisher: { '@id': `${SITE_URL}/#organization` },
    inLanguage: 'en',
};

export const extensionApp = {
    '@type': 'SoftwareApplication',
    '@id': `${SITE_URL}/#extension`,
    name: 'FreeAgentCoder — Free AI Coding Agent',
    alternateName: ['Free Agent Coder', 'FreeAgentCoder'],
    applicationCategory: 'DeveloperApplication',
    applicationSubCategory: 'Visual Studio Code extension',
    operatingSystem: 'Windows, macOS, Linux',
    url: MARKETPLACE,
    downloadUrl: MARKETPLACE,
    softwareVersion: '0.3.0',
    license: 'https://opensource.org/licenses/MIT',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    featureList: [
        'Plans, edits and verifies code across a project',
        'Runs on free Gemini, Groq, Cerebras, Mistral and OpenRouter API keys',
        'Automatic failover between keys when one hits its limit',
        "Finishes only when the project's own tests, type check or build pass",
        'API keys stay on your device, encrypted in VS Code Secret Storage',
    ],
    publisher: { '@id': `${SITE_URL}/#organization` },
};

export const brainApp = {
    '@type': 'WebApplication',
    '@id': `${SITE_URL}/#projectbrain`,
    name: 'Project Brain',
    applicationCategory: 'DeveloperApplication',
    browserRequirements: 'Requires JavaScript',
    url: SITE_URL,
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    featureList: [
        'Analyze any public GitHub repository in seconds',
        'Answers that cite real files and line ranges',
        'Ranked code search',
        'Impact analysis for a proposed change',
        'Implementation plans handed to a VS Code agent',
    ],
    publisher: { '@id': `${SITE_URL}/#organization` },
};

export const faqPage = (faq: { q: string; a: string }[], path = '/') => ({
    '@type': 'FAQPage',
    '@id': `${canonical(path)}#faq`,
    mainEntity: faq.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
});

export const graph = (nodes: object[]) => ({ '@context': 'https://schema.org', '@graph': nodes });
