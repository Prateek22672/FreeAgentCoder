/** Everything FreeAgentCoder can read from an attachment, shared by the reader and the file picker. */

export const OFFICE_EXTENSIONS = ['.pdf', '.docx', '.docm', '.dotx', '.pptx', '.pptm', '.potx', '.xlsx', '.xlsm', '.xltx', '.odt', '.ods', '.odp', '.epub', '.zip', '.eml', '.doc', '.xls', '.ppt', '.msg'];

export const TEXT_EXTENSIONS = [
    '.txt', '.text', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.yaml', '.yml', '.xml', '.html', '.htm',
    '.rtf', '.log', '.ini', '.cfg', '.conf', '.toml', '.env', '.properties', '.rst', '.adoc', '.tex', '.srt', '.vtt',
    // Common source files
    '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.py', '.ipynb', '.java', '.kt', '.kts', '.scala',
    '.groovy', '.gradle', '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.cs', '.fs', '.go', '.rs', '.rb', '.php',
    '.swift', '.m', '.mm', '.dart', '.lua', '.r', '.pl', '.pm', '.ex', '.exs', '.erl', '.hs', '.clj', '.ml', '.elm',
    '.jl', '.zig', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.psm1', '.bat', '.cmd', '.sql', '.graphql', '.gql',
    '.proto', '.css', '.scss', '.sass', '.less', '.vue', '.svelte', '.astro', '.tf', '.hcl', '.dockerfile',
    '.diff', '.patch', '.lock',
];

export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];

/** The file picker's accept list: every image type and every document extension. */
export const PICKER_ACCEPT = [...IMAGE_MIME_TYPES.filter((m) => m !== 'image/jpg'), ...OFFICE_EXTENSIONS, ...TEXT_EXTENSIONS].join(',');
