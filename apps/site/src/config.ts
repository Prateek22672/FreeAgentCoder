// Every install button, the /install redirect, canonical/OG URLs, robots.txt and sitemap.xml update from this object.
export const config = {
  /** Production origin, no trailing slash. Used for canonical, Open Graph, robots.txt and sitemap.xml. */
  site: 'https://foliofyx.in',
  /**
   * Path the site is served under, no trailing slash. Empty for a domain root
   * or a subdomain; set to '/freeagentcoder' to serve it from foliofyx.in
   * instead. Assets are already relative, so this only moves the internal links.
   */
  basePath: '/freeagentcoder',
  /** VS Code Marketplace publisher ID. */
  publisher: 'PrateekKoratala',
  /** Creator shown in the credits. */
  creator: 'Prateek Koratala',
  extension: 'freeagentcoder',
  /** Public repository URL. */
  github: 'https://github.com/Prateek22672/FreeAgentCoder',
  /**
   * Flip to true once the extension has actually been uploaded to the
   * Marketplace (publisher + repo can be filled in beforehand; the install
   * buttons should stay in "Soon" state until there's really something to install).
   */
  published: true,
};

export const released = config.published;

/** An internal link, correct whether the site sits at a domain root or under a path. */
export function href(path: string): string {
  return `${config.basePath}${path}`;
}

const extensionId = `${config.publisher}.${config.extension}`;

export const links = {
  site: config.site,
  issues: `${config.github}/issues`,
  changelog: `${config.github}/blob/main/freeagentcoder/CHANGELOG.md`,
  /** The file that stores API keys, linked as proof of the key-storage claim. */
  keyStorage: `${config.github}/blob/main/freeagentcoder/src/keys/keyStore.ts`,
  review: released ? `https://marketplace.visualstudio.com/items?itemName=${extensionId}&ssr=false#review-details` : '',
  qna: released ? `https://marketplace.visualstudio.com/items?itemName=${extensionId}&ssr=false#qna` : '',
  vscode: released ? `vscode:extension/${extensionId}` : '',
  marketplace: released ? `https://marketplace.visualstudio.com/items?itemName=${extensionId}` : '',
  openVsx: released ? `https://open-vsx.org/extension/${config.publisher}/${config.extension}` : '',
  github: config.github,
  releases: config.github ? `${config.github}/releases/latest` : '',
};

export function installCommand(cli: 'code' | 'cursor'): string {
  return `${cli} --install-extension ${released ? extensionId : `<publisher>.${config.extension}`}`;
}

/** vscode: links do nothing when VS Code isn't installed, so fall back to the Marketplace page. */
export function openInVsCode(): void {
  if (!released) {
    return;
  }
  let leftPage = false;
  const onBlur = () => {
    leftPage = true;
  };
  window.addEventListener('blur', onBlur, { once: true });
  window.location.href = links.vscode;
  window.setTimeout(() => {
    window.removeEventListener('blur', onBlur);
    if (!leftPage && !document.hidden) {
      window.location.href = links.marketplace;
    }
  }, 1600);
}
