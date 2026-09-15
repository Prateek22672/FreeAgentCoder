const PATHS = {
    send: '<path d="M8 13V3M3.5 7.5 8 3l4.5 4.5"/>',
    stop: '<rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" stroke="none"/>',
    plus: '<path d="M8 3v10M3 8h10"/>',
    gear: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>',
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
