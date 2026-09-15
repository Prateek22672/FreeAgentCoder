/** The starter project every new Builder session begins with. */
export const PROJECT_NAME_DEFAULT = 'Untitled app';

export const TEMPLATE_FILES: Record<string, string> = {
  '/package.json': `${JSON.stringify(
    {
      name: 'agentic-app',
      private: true,
      dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1', 'lucide-react': '^0.460.0' },
      devDependencies: { typescript: '^5.5.4' },
    },
    null,
    2,
  )}\n`,
  '/src/main.tsx': `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`,
  '/src/App.tsx': `export default function App() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-8">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight">Your app starts here</h1>
        <p className="text-zinc-400">
          Describe what you want to build in the chat. The agent edits this project and the preview updates live.
        </p>
      </div>
    </main>
  );
}
`,
  '/src/index.css': `/* Tailwind utility classes are available everywhere. Add custom CSS here. */
body { margin: 0; }
`,
};

/** Files Sandpack needs that the model never touches. */
export const PREVIEW_HIDDEN_FILES: Record<string, string> = {
  '/public/index.html': `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Preview</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`,
  '/tsconfig.json': `${JSON.stringify(
    { compilerOptions: { target: 'ES2020', lib: ['DOM', 'DOM.Iterable', 'ES2020'], jsx: 'react-jsx', module: 'ESNext', moduleResolution: 'Bundler', strict: true, skipLibCheck: true, esModuleInterop: true } },
    null,
    2,
  )}\n`,
};

export const EXAMPLE_PROMPTS = [
  'A kanban board with drag-and-drop columns, cards with labels, and localStorage persistence',
  'A personal finance dashboard with a spending chart, transactions table, and monthly budget bar',
  'A pomodoro timer with task list, session history, and a calm, minimal design',
  'A landing page for an AI note-taking app: hero, features grid, pricing, FAQ, footer',
  'A markdown notes app with a sidebar of notes, live preview, and search',
];

export function parseDependencies(packageJson: string | undefined): Record<string, string> {
  if (!packageJson) return {};
  try {
    const parsed = JSON.parse(packageJson) as { dependencies?: Record<string, string> };
    const deps = { ...(parsed.dependencies ?? {}) };
    deps.react ??= '^18.3.1';
    deps['react-dom'] ??= '^18.3.1';
    return deps;
  } catch {
    return { react: '^18.3.1', 'react-dom': '^18.3.1' };
  }
}
