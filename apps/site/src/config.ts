// Fill these in once the extension is published; every install button and the /install redirect update from here.
export const config = {
  /** VS Code Marketplace publisher ID, e.g. "prateek". Leave empty until the extension is live. */
  publisher: '',
  extension: 'freeagentcoder',
  /** Public repository URL, e.g. "https://github.com/your-name/freeagentcoder". */
  github: '',
};

export const released = config.publisher !== '';

const extensionId = `${config.publisher}.${config.extension}`;

export const links = {
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
