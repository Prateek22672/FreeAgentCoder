const PATHS = {
    send: '<path d="M8 13V3M3.5 7.5 8 3l4.5 4.5"/>',
    stop: '<rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" stroke="none"/>',
    plus: '<path d="M8 3v10M3 8h10"/>',
    gear: '<path fill="currentColor" stroke="none" fill-rule="evenodd" d="M6.68 3.07L6.87 0.89L9.13 0.89L9.32 3.07L9.95 3.29L10.55 3.58L12.23 2.18L13.82 3.77L12.42 5.45L12.71 6.05L12.93 6.68L15.11 6.87L15.11 9.13L12.93 9.32L12.71 9.95L12.42 10.55L13.82 12.23L12.23 13.82L10.55 12.42L9.95 12.71L9.32 12.93L9.13 15.11L6.87 15.11L6.68 12.93L6.05 12.71L5.45 12.42L3.77 13.82L2.18 12.23L3.58 10.55L3.29 9.95L3.07 9.32L0.89 9.13L0.89 6.87L3.07 6.68L3.29 6.05L3.58 5.45L2.18 3.77L3.77 2.18L5.45 3.58L6.05 3.29ZM8 5.8L8.84 5.97L9.56 6.44L10.03 7.16L10.2 8L10.03 8.84L9.56 9.56L8.84 10.03L8 10.2L7.16 10.03L6.44 9.56L5.97 8.84L5.8 8L5.97 7.16L6.44 6.44L7.16 5.97Z"/>',
    history: '<path d="M2.2 5.5A6 6 0 1 1 2 8.6"/><path d="M1.6 2.6v3.2h3.2"/><path d="M8 4.8V8l2.3 1.4"/>',
    pulse: '<path d="M1.5 8.5h2.8l1.9-5 3.4 9 1.9-4h3"/>',
    bulb: '<path d="M6 13.5h4M6.5 11.5h3"/><path d="M8 1.8a4.2 4.2 0 0 0-2.4 7.7V11h4.8V9.5A4.2 4.2 0 0 0 8 1.8z"/>',
    copy: '<rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.5"/><path d="M10.5 5.5V3.5a1.5 1.5 0 0 0-1.5-1.5H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2"/>',
    paperclip: '<path d="M13.2 7.6 8 12.8a3.2 3.2 0 0 1-4.5-4.5l5.6-5.6a2.1 2.1 0 0 1 3 3L6.6 11.2a1.1 1.1 0 0 1-1.5-1.5L10 4.8"/>',
    image: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><circle cx="5.5" cy="6" r="1.2"/><path d="m1.5 11.5 3.8-3.8 2.7 2.7 2.2-2.2 4.3 4.3"/>',
    brain: '<path d="M6 2.5a2 2 0 0 0-2 2 2 2 0 0 0-1.5 3.2A2.2 2.2 0 0 0 4 11.5a2 2 0 0 0 2 2V2.5zM10 2.5a2 2 0 0 1 2 2 2 2 0 0 1 1.5 3.2 2.2 2.2 0 0 1-1.5 3.8 2 2 0 0 1-2 2V2.5z"/><path d="M6 2.5h4M6 13.5h4"/>',
    target: '<circle cx="8" cy="8" r="6.5"/><circle cx="8" cy="8" r="3.5"/><circle cx="8" cy="8" r=".8" fill="currentColor"/>',
    grid: '<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>',
    lock: '<rect x="3" y="7" width="10" height="7.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
    back: '<path d="M10 3 5 8l5 5"/>',
    close: '<path d="M4 4l8 8M12 4l-8 8"/>',
    check: '<path d="M3 8.5 6.5 12 13 4.5"/>',
    chevron: '<path d="M6 4l4 4-4 4"/>',
    chevronDown: '<path d="M4 6l4 4 4-4"/>',
    file: '<path d="M4 1.5h5l3 3v10H4z"/><path d="M9 1.5v3h3"/>',
    filePlus: '<path d="M4 1.5h5l3 3v10H4z"/><path d="M8 7v5M5.5 9.5h5"/>',
    pencil: '<path d="M11 2.5l2.5 2.5L6 12.5 3 13l.5-3z"/>',
    terminal: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M4.5 6l2 2-2 2M8.5 10.5h3"/>',
    search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/>',
    folder: '<path d="M1.5 4a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"/>',
    globe: '<circle cx="8" cy="8" r="6.5"/><path d="M1.5 8h13M8 1.5c2 2 2 11 0 13M8 1.5c-2 2-2 11 0 13"/>',
    list: '<path d="M6 4h8M6 8h8M6 12h8"/><circle cx="2.8" cy="4" r=".8" fill="currentColor"/><circle cx="2.8" cy="8" r=".8" fill="currentColor"/><circle cx="2.8" cy="12" r=".8" fill="currentColor"/>',
    key: '<circle cx="5" cy="11" r="3"/><path d="M7.2 8.8 13.5 2.5M11 5l2 2M9.5 6.5l1.5 1.5"/>',
    alert: '<path d="M8 1.8 15 14H1z"/><path d="M8 6.5v3.5M8 12v.1"/>',
    info: '<circle cx="8" cy="8" r="6.5"/><path d="M8 7.5V11M8 5v.1"/>',
    undo: '<path d="M4 6h6.5a3.5 3.5 0 0 1 0 7H6"/><path d="M6.5 3.5 4 6l2.5 2.5"/>',
    bolt: '<path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z"/>',
    layers: '<path d="M8 2 14.5 5.5 8 9 1.5 5.5z"/><path d="M1.5 8.5 8 12l6.5-3.5"/>',
    shield: '<path d="M8 1.5 13.5 3.5v4c0 3.5-2.5 6-5.5 7-3-1-5.5-3.5-5.5-7v-4z"/>',
    gauge: '<path d="M2 11a6 6 0 1 1 12 0"/><path d="M8 11l3-4"/>',
    eye: '<path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/>',
    eyeOff: '<path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><path d="M2 2l12 12"/>',
    trash: '<path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4"/>',
    refresh: '<path d="M13.5 8A5.5 5.5 0 1 1 11.9 4"/><path d="M13.5 2v3h-3"/>',
    external: '<path d="M9 2.5h4.5V7M13.5 2.5 7 9"/><path d="M12 9.5v4H2.5V4h4"/>',
    spark: '<path d="M8 1.5 9.4 6.6 14.5 8 9.4 9.4 8 14.5 6.6 9.4 1.5 8 6.6 6.6z"/>',
    mark: '<path fill="currentColor" stroke="none" fill-rule="evenodd" d="M2 2h9v3H5v6H2zM14 14H5v-3h6V5h3zM7 7h2v2H7z"/>',
};

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, extraClass = ''): HTMLElement {
    const span = document.createElement('span');
    span.className = extraClass ? `icon ${extraClass}` : 'icon';
    span.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
    return span;
}
