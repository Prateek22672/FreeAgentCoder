/** Approved wording for where API keys live. Use verbatim; don't embellish. */
export const KEY_STORAGE =
  "Your API keys stay on your device. They are stored encrypted in VS Code's Secret Storage (your operating system's keychain: Windows Credential Manager, macOS Keychain or Linux Secret Service), are never uploaded to FreeAgentCoder or anyone else, and are sent only to the provider each key belongs to when you run a task. No account, no server, no telemetry.";

export const KEYCHAINS = [
  { os: 'Windows', store: 'Credential Manager' },
  { os: 'macOS', store: 'Keychain' },
  { os: 'Linux', store: 'Secret Service' },
];

export interface Feature {
  id: string;
  title: string;
  tag: string;
  summary: string;
  points: string[];
  where?: string;
}

export const FEATURES: Feature[] = [
  {
    id: 'routing',
    title: 'Smart routing & failover',
    tag: 'Uses all your keys',
    summary: 'Every request goes to the right model, and every key you add keeps the task moving.',
    points: [
      'Quick questions and small edits go to the fastest models (Groq, Cerebras). Builds, debugging and multi-file work go to the strongest (Gemini). Choosing costs no extra request.',
      'Add several named keys per provider, such as “Personal” and “College”. When one is rate-limited, the next continues the same task, starting with the key you’ve used least today.',
      'A failing model hands over immediately and cools down for a while. Invalid keys are detected and flagged.',
      'Pin any model from the model menu; your other free keys stay available as fallbacks. Paid OpenAI and Anthropic keys are only used automatically when you have no free key.',
    ],
  },
  {
    id: 'senior',
    title: 'Senior mode',
    tag: 'For complex builds',
    summary: 'For big asks like “build a Flutter app that’s ready to publish”, it works the way a senior engineer would.',
    points: [
      'Environment check first: it sees which SDKs are installed before writing code, and asks before installing anything system-wide.',
      'Stack playbooks for Flutter, web apps, Node.js APIs, Python backends and machine learning, each with the structure, security rules and release steps they need.',
      'Required quality checks: it can’t call the task done until analysis, tests and builds actually pass, or it explains exactly why one can’t run.',
      'An honest quality report listing every check it ran, passed or failed, plus a security and publishing checklist for you.',
    ],
  },
  {
    id: 'recovery',
    title: 'Automatic recovery',
    tag: 'No lost progress',
    summary: 'Rate limits and dropped connections pause a task instead of ending it.',
    points: [
      'If every model is rate-limited, the task waits and picks up where it stopped.',
      'If your connection drops, it waits and resumes on its own.',
      'Press Stop at any time to cancel.',
    ],
  },
  {
    id: 'search',
    title: 'Instant local code search',
    tag: 'No API quota',
    summary: 'A built-in index of file names and identifiers finds the right files for a request without using any API quota.',
    points: [
      'Runs on your computer, so searching your code costs no requests.',
      'Complex tasks start with the most relevant files already attached.',
      'Respects .gitignore and skips dependency, cache and experiment-tracking folders.',
    ],
  },
  {
    id: 'attachments',
    title: 'Attachments',
    tag: 'Screenshots & documents',
    summary: 'Show it what you mean instead of describing it.',
    points: [
      'Paste screenshots, PDFs, Word, PowerPoint or Excel documents, or long text into the chat.',
      'Attachments are read by a dedicated reader model.',
      'Handy for error screenshots, design mockups, requirement documents and long logs.',
    ],
  },
  {
    id: 'correction',
    title: 'Correction mode',
    tag: 'Precise fixes',
    summary: 'Point at what’s wrong, and it fixes exactly that.',
    points: [
      'Describe the problem with a screenshot or a short note.',
      'It works through what you pointed out, point by point.',
      'Lessons from your corrections can be kept in Project memory.',
    ],
  },
  {
    id: 'memory',
    title: 'Project memory',
    tag: 'You stay in control',
    summary: 'It learns lessons from your corrections.',
    points: ['Lessons come from the corrections you make.', 'View, edit or delete any lesson.', 'Turn memory off whenever you like.'],
  },
  {
    id: 'usage',
    title: 'Usage & limits',
    tag: 'Know what’s left',
    summary: 'See how each key is being used, and how much room you have left today.',
    points: [
      'Tokens and requests for each key: today, since VS Code started, and over the last 30 days.',
      'Quota bars show only the limits a provider reports. Gemini doesn’t report limits, so Gemini keys show local usage only.',
      'Provider-reported limits added up across all your keys, with a warning when a key drops below 10% of a reported limit.',
      'Key suggestions based on what actually happened, and an estimate of how many prompts you have left today.',
    ],
  },
  {
    id: 'history',
    title: 'Chat history',
    tag: 'Local only',
    summary: 'Saved on your computer, and only if you say yes.',
    points: [
      'Nothing is saved until you give permission.',
      'Reopen, search and delete past chats from the History button.',
      'Turn it off or delete saved chats any time.',
    ],
    where: 'Settings → History',
  },
  {
    id: 'logs',
    title: 'Local error log',
    tag: 'Safe to share',
    summary: 'Errors are logged on your computer, along with what was fixed automatically.',
    points: [
      'Copy diagnostics removes API keys, tokens and your username from paths before copying.',
      'Each key’s last error is shown in Settings.',
      'Nothing is sent anywhere; you decide what to share.',
    ],
    where: 'Settings → Logs',
  },
  {
    id: 'permissions',
    title: 'Permission modes',
    tag: 'Safe by default',
    summary: 'Choose how much it can do without asking.',
    points: [
      'Manual: reads files without asking. Everything else waits for your approval.',
      'Auto-edit (default): reads and edits files without asking.',
      'Auto: reads and edits files and runs commands without asking.',
      'In every mode, risky commands such as deleting files, git push or deploys always ask, and so do system-wide installs and PATH changes. Commands that could wipe a disk are always blocked, and any task that changed files can be undone.',
    ],
  },
];

export interface Provider {
  name: string;
  plan: string;
  paid: boolean;
  goodAt: string;
  note: string;
  keyUrl?: string;
  keyHost?: string;
}

export const PROVIDERS: Provider[] = [
  {
    name: 'Google Gemini',
    plan: 'Free tier',
    paid: false,
    goodAt: 'The strongest free models: builds, debugging and multi-file work. 1M-token context.',
    note: 'Daily request quota. Doesn’t report limits, so usage is tracked locally.',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHost: 'aistudio.google.com',
  },
  {
    name: 'Groq',
    plan: 'Free tier',
    paid: false,
    goodAt: 'Very fast: quick questions and small edits.',
    note: 'Small per-minute token limit.',
    keyUrl: 'https://console.groq.com/keys',
    keyHost: 'console.groq.com',
  },
  {
    name: 'Cerebras',
    plan: 'Free tier',
    paid: false,
    goodAt: 'Fast: quick questions and small edits.',
    note: 'Per-minute request limit.',
    keyUrl: 'https://cloud.cerebras.ai',
    keyHost: 'cloud.cerebras.ai',
  },
  {
    name: 'Mistral',
    plan: 'Free tier',
    paid: false,
    goodAt: 'Another free provider to spread your requests across.',
    note: '“Experiment” plan; needs phone verification.',
    keyUrl: 'https://console.mistral.ai/api-keys',
    keyHost: 'console.mistral.ai',
  },
  {
    name: 'OpenRouter',
    plan: 'Free models',
    paid: false,
    goodAt: 'Free models from several model makers behind one key.',
    note: 'Daily request limit.',
    keyUrl: 'https://openrouter.ai/keys',
    keyHost: 'openrouter.ai',
  },
  {
    name: 'OpenAI',
    plan: 'Paid',
    paid: true,
    goodAt: 'Bring your own paid key if you already have one.',
    note: 'Only used automatically when you have no free key.',
  },
  {
    name: 'Anthropic',
    plan: 'Paid',
    paid: true,
    goodAt: 'Bring your own paid key if you already have one.',
    note: 'Only used automatically when you have no free key.',
  },
];

export const FAQ: { q: string; a: string }[] = [
  {
    q: 'Is FreeAgentCoder really free?',
    a: 'Yes. The extension is free and MIT licensed, and it runs on the free tiers of providers like Gemini, Groq, Cerebras, Mistral and OpenRouter using your own keys. Paid OpenAI and Anthropic keys are optional, and are only used automatically when you have no free key. Each provider’s own limits and terms apply.',
  },
  {
    q: 'Is it an alternative to paid AI coding assistants?',
    a: 'Yes. It is a free alternative to subscription tools such as GitHub Copilot, Cursor or Claude Code: there is no subscription, no seat fee and no usage metering of ours. You bring your own API keys, so the only limits are the free tiers of the providers you pick — and you can add as many keys as you like, which is exactly what FreeAgentCoder is built around. It is not affiliated with any of those products.',
  },
  {
    q: 'Where are my API keys stored?',
    a: KEY_STORAGE,
  },
  {
    q: 'Where do my prompts and code go?',
    a: 'Directly from your editor to the providers whose keys you add. FreeAgentCoder has no server of its own and collects no telemetry. Provider terms apply, and some free tiers may use requests to improve their models, so check a provider’s data policy before working on sensitive code.',
  },
  {
    q: 'How many API keys do I need?',
    a: 'One is enough to start. More keys give you more requests per day and a fallback when one hits its limit. The keys calculator on this page gives an estimate based on how you work.',
  },
  {
    q: 'What happens when a key hits its limit?',
    a: 'That key cools down and your next key continues the same task, starting with the one you’ve used least today. If every key is rate-limited, the task waits and resumes by itself. You can press Stop at any time.',
  },
  {
    q: 'Which editors does it work in?',
    a: 'VS Code 1.137 or newer. Cursor, Windsurf and VSCodium can install the .vsix file from GitHub Releases, and will be able to install it from Open VSX once it is listed there.',
  },
  {
    q: 'Can it break my project?',
    a: 'In Manual mode it asks before every change. In every mode, risky commands like deleting files, git push or deploys need your approval, commands that could wipe a disk are blocked, and you can undo the files changed by each task.',
  },
];
