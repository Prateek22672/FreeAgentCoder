/**
 * What a new playground project starts from. Every starter has a package.json
 * with a `dev` script, because that is what the in-browser runtime runs.
 * Kept small on purpose: the point is to have something running in a minute
 * and let the agent build the rest.
 */

export interface Starter {
    id: string;
    name: string;
    about: string;
    files: Record<string, string>;
}

const vitePackage = (name: string, deps: Record<string, string>, devDeps: Record<string, string>) =>
    JSON.stringify({ name, private: true, version: '0.0.0', type: 'module', scripts: { dev: 'vite', build: 'vite build' }, dependencies: deps, devDependencies: devDeps }, null, 2) + '\n';

export const STARTERS: Starter[] = [
    {
        id: 'react',
        name: 'React app',
        about: 'Vite + React. The usual start for a web app.',
        files: {
            'package.json': vitePackage('react-app', { react: '^18.3.1', 'react-dom': '^18.3.1' }, { vite: '^5.4.0', '@vitejs/plugin-react': '^4.3.1' }),
            'vite.config.js': "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({ plugins: [react()] });\n",
            'index.html':
                '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>React app</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.jsx"></script>\n  </body>\n</html>\n',
            'src/main.jsx':
                "import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App.jsx';\nimport './styles.css';\n\ncreateRoot(document.getElementById('root')).render(<App />);\n",
            'src/App.jsx':
                "import { useState } from 'react';\n\nexport default function App() {\n  const [count, setCount] = useState(0);\n  return (\n    <main>\n      <h1>Hello from the playground</h1>\n      <p>Ask the agent on the right to build something here.</p>\n      <button onClick={() => setCount(count + 1)}>Clicked {count} times</button>\n    </main>\n  );\n}\n",
            'src/styles.css':
                ':root { font-family: system-ui, sans-serif; color: #e9e9ea; background: #0c0c0d; }\nmain { max-width: 640px; margin: 15vh auto; padding: 0 24px; }\nbutton { padding: 8px 16px; border-radius: 8px; border: 0; background: #d97757; color: #fff; cursor: pointer; }\n',
        },
    },
    {
        id: 'html',
        name: 'HTML, CSS and JavaScript',
        about: 'No framework. A page, a stylesheet and a script.',
        files: {
            'package.json': vitePackage('web-page', {}, { vite: '^5.4.0' }),
            'index.html':
                '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>My page</title>\n    <link rel="stylesheet" href="/style.css" />\n  </head>\n  <body>\n    <main>\n      <h1>Hello from the playground</h1>\n      <p>Ask the agent on the right to build something here.</p>\n    </main>\n    <script type="module" src="/main.js"></script>\n  </body>\n</html>\n',
            'style.css': 'body { font-family: system-ui, sans-serif; color: #e9e9ea; background: #0c0c0d; }\nmain { max-width: 640px; margin: 15vh auto; padding: 0 24px; }\n',
            'main.js': "console.log('Ready.');\n",
        },
    },
    {
        id: 'node',
        name: 'Node API',
        about: 'An Express server with one route.',
        files: {
            'package.json':
                JSON.stringify({ name: 'node-api', private: true, version: '0.0.0', type: 'module', scripts: { dev: 'node --watch server.js', start: 'node server.js' }, dependencies: { express: '^4.19.2' } }, null, 2) + '\n',
            'server.js':
                "import express from 'express';\n\nconst app = express();\napp.use(express.json());\n\napp.get('/', (req, res) => {\n  res.json({ message: 'Hello from the playground. Ask the agent to add routes.' });\n});\n\napp.listen(3000, () => console.log('Listening on http://localhost:3000'));\n",
        },
    },
    {
        id: 'blank',
        name: 'Blank',
        about: 'An empty page. Describe what you want and let it build from nothing.',
        files: {
            'package.json': vitePackage('new-project', {}, { vite: '^5.4.0' }),
            'index.html': '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <title>New project</title>\n  </head>\n  <body></body>\n</html>\n',
        },
    },
];

export function starterById(id: string): Starter | undefined {
    return STARTERS.find((s) => s.id === id);
}
