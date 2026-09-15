import { compactNumber, formatDuration } from '../../shared/format';
import type { ApprovalView, AttachmentView, DiffLineView, LessonView, TodoView, ToWebview, TurnEndReason } from '../../shared/protocol';
import { button, fileLink, h, handleContentClick, openSettingsEvent, send } from './dom';
import { icon, type IconName } from './icons';
import { renderMarkdown } from './markdown';

type Msg<T extends ToWebview['type']> = Extract<ToWebview, { type: T }>;

const READ_TOOLS = new Set(['read_file', 'list_dir', 'glob', 'grep', 'search_code']);
const EDIT_TOOLS = new Set(['write_file', 'edit_file']);
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

function toolIcon(tool: string): IconName {
    switch (tool) {
        case 'read_file':
            return 'file';
        case 'list_dir':
            return 'folder';
        case 'glob':
        case 'grep':
        case 'search_code':
            return 'search';
        case 'write_file':
            return 'filePlus';
        case 'edit_file':
            return 'pencil';
        case 'run_command':
        case 'process':
            return 'terminal';
        case 'fetch_url':
            return 'globe';
        case 'inspect_environment':
            return 'gauge';
        case 'todo_write':
            return 'list';
        default:
            return 'spark';
    }
}

function preparingText(tool: string): string {
    if (EDIT_TOOLS.has(tool)) {
        return 'Writing code…';
    }
    if (tool === 'run_command') {
        return 'Preparing a command…';
    }
    if (tool === 'todo_write') {
        return 'Planning…';
    }
    if (tool === 'fetch_url') {
        return 'Opening a web page…';
    }
    return READ_TOOLS.has(tool) ? 'Exploring the project…' : 'Working…';
}

const VERBS: Record<string, string> = {
    Read: 'Reading',
    Edit: 'Editing',
    Write: 'Writing',
    Create: 'Creating',
    List: 'Listing',
    Search: 'Searching',
    Find: 'Finding',
    Fetch: 'Fetching',
    Update: 'Updating',
    Check: 'Checking',
};

function activeText(label: string): string {
    if (label.startsWith('$')) {
        return `Running ${label.slice(1).trim()}`;
    }
    const [first, ...rest] = label.split(' ');
    return VERBS[first] ? `${VERBS[first]} ${rest.join(' ')}…` : `${label}…`;
}

function plural(count: number, one: string, many = `${one}s`): string {
    return count ? `${count} ${count === 1 ? one : many}` : '';
}

function attachmentList(items: AttachmentView[]): HTMLElement {
    return h(
        'div',
        { class: 'user-attachments' },
        ...items.map((item) =>
            item.thumb
                ? h('img', { title: item.name, attrs: { src: item.thumb, alt: item.name } })
                : h('span', { class: 'user-file', title: item.name }, icon(item.kind === 'image' ? 'image' : item.kind === 'text' ? 'list' : 'file'), h('span', { text: item.name })),
        ),
    );
}

export class Transcript {
    private readonly turns = new Map<string, TurnView>();
    private pinned = true;

    constructor(
        private readonly scroller: HTMLElement,
        readonly list: HTMLElement,
        private readonly onChange: () => void,
    ) {
        scroller.addEventListener('scroll', () => {
            this.pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 60;
        });
        list.addEventListener('click', handleContentClick);
    }

    get isEmpty(): boolean {
        return this.list.childElementCount === 0;
    }

    clear(): void {
        for (const turn of this.turns.values()) {
            turn.dispose();
        }
        this.turns.clear();
        this.list.replaceChildren();
        this.pinned = true;
        this.onChange();
    }

    handle(message: ToWebview): void {
        switch (message.type) {
            case 'error': {
                const card = errorCard(message);
                if (message.turnId) {
                    this.turn(message.turnId).append(card);
                } else {
                    this.list.append(card);
                    this.onChange();
                }
                this.scroll(true);
                return;
            }
            case 'turnStart':
                this.turn(message.turnId).start(message);
                this.onChange();
                this.scroll(true);
                return;
            case 'model':
                this.turn(message.turnId).model(message);
                break;
            case 'text':
                this.turn(message.turnId).textDelta(message.delta);
                break;
            case 'reasoning':
                this.turn(message.turnId).reasoning(message.delta);
                break;
            case 'resetText':
                this.turn(message.turnId).resetText();
                break;
            case 'assistant':
                this.turn(message.turnId).assistant(message.content);
                break;
            case 'preparing':
                this.turn(message.turnId).preparing(message.tool);
                break;
            case 'toolStart':
                this.turn(message.turnId).toolStart(message);
                break;
            case 'toolOutput':
                this.turn(message.turnId).toolOutput(message.callId, message.chunk);
                break;
            case 'toolEnd':
                this.turn(message.turnId).toolEnd(message);
                break;
            case 'approval':
                this.turn(message.turnId).approval(message.approval);
                this.scroll(true);
                return;
            case 'approvalResolved':
                this.turn(message.turnId).approvalResolved(message.id, message.allowed);
                break;
            case 'todos':
                this.turn(message.turnId).todos(message.todos);
                break;
            case 'notice':
                this.turn(message.turnId).notice(message.message, message.level);
                break;
            case 'turnEnd':
                if (message.canUndo) {
                    for (const other of this.turns.values()) {
                        other.disableUndo();
                    }
                }
                this.turn(message.turnId).end(message);
                break;
            case 'undone':
                this.turn(message.turnId).undone(message);
                break;
            case 'checks':
                this.turn(message.turnId).checks(message);
                break;
            case 'learned':
                this.turn(message.turnId).learned(message.lessons);
                break;
            default:
                return;
        }
        this.scroll();
    }

    private turn(id: string): TurnView {
        let view = this.turns.get(id);
        if (!view) {
            view = new TurnView(id);
            this.turns.set(id, view);
            this.list.append(view.root);
        }
        return view;
    }

    private scroll(force = false): void {
        if (force) {
            this.pinned = true;
        }
        if (this.pinned) {
            requestAnimationFrame(() => {
                this.scroller.scrollTop = this.scroller.scrollHeight;
            });
        }
    }
}

interface ToolView {
    readonly el: HTMLElement;
    output(chunk: string): void;
    end(message: Msg<'toolEnd'>): void;
    cancel(): void;
}

class TurnView {
    readonly root = h('section', { class: 'turn' });
    private readonly header = h('div', { class: 'agent-header' });
    private readonly body = h('div', { class: 'agent-body' });
    private readonly modelChip = h('span', { class: 'chip', hidden: true });
    private startedAt = Date.now();
    private plan?: PlanCard;
    private text?: { el: HTMLElement; raw: string; timer?: number };
    private thinking?: { label: HTMLElement; pre: HTMLElement; raw: string; startedAt: number };
    private group?: ExploreGroup;
    private fallback?: { label: HTMLElement; list: HTMLElement; count: number };
    private readonly tools = new Map<string, ToolView>();
    private readonly approvals = new Map<string, HTMLElement>();
    private status?: StatusLine;
    private footer?: HTMLElement;
    private undoButton?: HTMLButtonElement;

    constructor(readonly id: string) {
        this.header.append(icon('mark', 'brand-mark'), h('span', { class: 'agent-name', text: 'FreeAgentCoder' }), this.modelChip);
        this.root.append(h('div', { class: 'agent' }, this.header, this.body));
    }

    start(message: Msg<'turnStart'>): void {
        this.startedAt = message.at;
        this.root.prepend(
            h(
                'div',
                { class: 'user-msg' },
                message.attachments?.length ? attachmentList(message.attachments) : null,
                h('div', { class: 'user-text', text: message.prompt }),
            ),
        );
        if (message.correction) {
            this.header.insertBefore(
                h('span', { class: 'chip correction', title: 'Correction mode: each point you raised is fixed and verified separately' }, icon('target'), 'Correction'),
                this.modelChip,
            );
        }
        if (message.lessons) {
            this.header.insertBefore(
                h(
                    'span',
                    { class: 'chip lessons', title: 'Lessons from your earlier corrections were added to this task' },
                    icon('brain'),
                    `${message.lessons} lesson${message.lessons === 1 ? '' : 's'}`,
                ),
                this.modelChip,
            );
        }
        const fast = message.tier === 'fast';
        const chip = message.pinned
            ? h('span', { class: 'chip tier pinned', title: message.tierReason }, icon('layers'), 'Pinned model')
            : h('span', { class: `chip tier ${message.tier}`, title: message.tierReason }, icon(fast ? 'bolt' : 'layers'), fast ? 'Fast' : 'Deep');
        this.header.insertBefore(chip, this.modelChip);
        if (message.playbooks.length) {
            this.header.insertBefore(
                h(
                    'span',
                    { class: 'chip playbook', title: 'Senior mode: stack playbook, required quality checks and a publishing checklist' },
                    icon('shield'),
                    `${message.playbooks.join(' + ')} playbook`,
                ),
                this.modelChip,
            );
        }
        this.setStatus('Starting…');
    }

    model(message: Msg<'model'>): void {
        const model = message.model.split('/').pop() ?? message.model;
        this.modelChip.hidden = false;
        this.modelChip.textContent = `${message.providerLabel} · ${model} · ${message.keyLabel}`;
        this.modelChip.title = `${message.providerLabel} · ${message.model} · key "${message.keyLabel}"`;
        if (!this.text) {
            this.setStatus('Thinking…');
        }
    }

    append(node: Node): void {
        if (this.status) {
            this.body.insertBefore(node, this.status.el);
        } else {
            this.body.append(node);
        }
    }

    textDelta(delta: string): void {
        this.closeThinking();
        this.closeGroup();
        this.fallback = undefined;
        if (!this.text) {
            const el = h('div', { class: 'md' });
            this.append(el);
            this.text = { el, raw: '' };
        }
        const text = this.text;
        text.raw += delta;
        text.timer ??= window.setTimeout(() => {
            text.timer = undefined;
            text.el.innerHTML = renderMarkdown(text.raw);
        }, 50);
        this.setStatus('Writing…');
    }

    resetText(): void {
        if (this.text) {
            clearTimeout(this.text.timer);
            this.text.el.remove();
            this.text = undefined;
        }
    }

    assistant(content: string): void {
        const hasContent = !!content.trim();
        if (!this.text && hasContent) {
            const el = h('div', { class: 'md' });
            this.append(el);
            this.text = { el, raw: '' };
        }
        if (!this.text) {
            return;
        }
        clearTimeout(this.text.timer);
        if (hasContent) {
            this.text.el.innerHTML = renderMarkdown(content);
        } else {
            this.text.el.remove();
        }
        this.text = undefined;
    }

    reasoning(delta: string): void {
        if (!this.thinking) {
            const label = h('span', { text: 'Thinking…' });
            const pre = h('div', { class: 'thinking-text' });
            this.append(h('details', { class: 'thinking' }, h('summary', {}, icon('chevron', 'caret'), label), pre));
            this.thinking = { label, pre, raw: '', startedAt: Date.now() };
        }
        this.thinking.raw += delta;
        this.thinking.pre.textContent = this.thinking.raw.length > 6_000 ? `…${this.thinking.raw.slice(-6_000)}` : this.thinking.raw;
        this.setStatus('Thinking…');
    }

    preparing(tool: string): void {
        this.setStatus(preparingText(tool));
    }

    toolStart(message: Msg<'toolStart'>): void {
        this.closeThinking();
        this.fallback = undefined;
        if (message.tool === 'todo_write') {
            this.setStatus('Updating the plan…');
            return;
        }
        if (READ_TOOLS.has(message.tool)) {
            if (!this.group) {
                this.group = new ExploreGroup();
                this.append(this.group.el);
            }
            this.tools.set(message.callId, this.group.add(message));
        } else {
            this.closeGroup();
            const view: ToolView = EDIT_TOOLS.has(message.tool)
                ? new EditCard(message)
                : message.tool === 'run_command'
                  ? new CommandCard(message)
                  : new RowCard(message, true);
            this.append(view.el);
            this.tools.set(message.callId, view);
        }
        this.setStatus(activeText(message.label));
    }

    toolOutput(callId: string, chunk: string): void {
        this.tools.get(callId)?.output(chunk);
    }

    toolEnd(message: Msg<'toolEnd'>): void {
        this.tools.get(message.callId)?.end(message);
        this.group?.refresh();
        this.setStatus('Thinking…');
    }

    todos(todos: TodoView[]): void {
        if (!this.plan) {
            this.plan = new PlanCard();
            this.body.prepend(this.plan.el);
        }
        this.plan.update(todos);
    }

    approval(approval: ApprovalView): void {
        this.closeThinking();
        this.closeGroup();
        const card = approvalCard(approval);
        this.approvals.set(approval.id, card);
        this.append(card);
        this.setStatus('Waiting for your approval', true);
    }

    approvalResolved(id: string, allowed: boolean): void {
        const card = this.approvals.get(id);
        if (!card) {
            return;
        }
        this.approvals.delete(id);
        card.classList.add('resolved');
        card.replaceChildren(
            h('div', { class: `approval-done ${allowed ? 'allowed' : 'denied'}` }, icon(allowed ? 'check' : 'close'), `${allowed ? 'Allowed' : 'Denied'} · ${card.dataset.label ?? ''}`),
        );
        this.setStatus(allowed ? 'Working…' : 'Adjusting after your answer…');
    }

    notice(message: string, level: 'info' | 'warn'): void {
        const switching = /; switching to (.+)\.$/.exec(message);
        if (switching) {
            this.fallbackNotice(message, switching[1]);
            return;
        }
        this.append(h('div', { class: `notice ${level}` }, icon(level === 'warn' ? 'alert' : 'info'), h('span', { text: message })));
        if (level === 'warn') {
            this.setStatus(message.length > 90 ? `${message.slice(0, 87)}…` : message);
        }
    }

    /** Model hand-offs are routine: fold consecutive ones into one expandable line. */
    private fallbackNotice(message: string, target: string): void {
        if (!this.fallback) {
            const label = h('span', { class: 'fallback-label' });
            const list = h('div', { class: 'fallback-list' });
            this.append(h('details', { class: 'fallback' }, h('summary', {}, icon('chevron', 'caret'), icon('alert'), label), list));
            this.fallback = { label, list, count: 0 };
        }
        this.fallback.count++;
        this.fallback.label.textContent = `${this.fallback.count === 1 ? 'Switched model' : `Switched model ${this.fallback.count} times`} · now ${target}`;
        this.fallback.list.append(h('div', { text: message }));
        this.setStatus(`Switching to ${target}…`);
    }

    end(message: Msg<'turnEnd'>): void {
        this.closeThinking();
        this.closeGroup();
        if (this.text) {
            this.assistant(this.text.raw);
        }
        for (const view of this.tools.values()) {
            view.cancel();
        }
        for (const card of this.approvals.values()) {
            card.querySelectorAll('button').forEach((b) => (b.disabled = true));
        }
        this.plan?.el.classList.add('ended');
        this.status?.dispose();
        this.status = undefined;
        this.footer?.remove();
        this.footer = this.buildFooter(message);
        this.body.append(this.footer);
    }

    checks(message: Msg<'checks'>): void {
        const blocking = message.gates.filter((g) => g.required && g.status !== 'passed').length;
        const passed = message.gates.filter((g) => g.status === 'passed').length;
        const card = h('div', { class: `card checks${blocking ? ' has-blocking' : ''}` });
        card.append(
            h(
                'div',
                { class: 'card-head' },
                icon('shield'),
                h('span', { class: 'card-title', text: `Quality report · ${message.playbooks.join(' + ')}` }),
                h('span', {
                    class: `badge ${blocking ? 'bad' : 'ok'}`,
                    text: blocking ? `${blocking} required check${blocking === 1 ? '' : 's'} not passing` : `${passed} of ${message.gates.length} passed`,
                }),
            ),
        );

        const gates = h('div', { class: 'gate-list' });
        for (const gate of message.gates) {
            const [iconName, tone, status]: [IconName, string, string] =
                gate.status === 'passed'
                    ? ['check', 'passed', 'Passed']
                    : gate.status === 'failed'
                      ? ['alert', 'failed', `Failed${gate.exitCode !== null && gate.exitCode !== undefined ? ` · exit ${gate.exitCode}` : ''}`]
                      : ['close', 'not-run', gate.required ? 'Not run' : 'Skipped'];
            gates.append(
                h(
                    'div',
                    { class: `gate ${tone}` },
                    icon(iconName),
                    h(
                        'div',
                        { class: 'gate-main' },
                        h('div', { class: 'gate-title' }, h('span', { text: gate.label }), gate.required ? h('span', { class: 'tag', text: 'REQUIRED' }) : null),
                        h('code', { class: 'gate-command', text: gate.command, title: gate.command }),
                    ),
                    h('span', { class: 'gate-status', text: status }),
                ),
            );
        }
        card.append(gates);

        const checklists: [string, string[]][] = [
            ['Security checklist', message.security],
            ['Before publishing', message.release],
        ];
        for (const [title, items] of checklists) {
            if (items.length) {
                card.append(
                    h(
                        'details',
                        { class: 'checklist' },
                        h('summary', {}, icon('chevron', 'caret'), h('span', { text: `${title} (${items.length})` })),
                        h('ul', {}, ...items.map((item) => h('li', { text: item }))),
                    ),
                );
            }
        }
        card.append(
            h('p', {
                class: 'checks-note',
                text: 'Checks reflect the commands the agent actually ran. Review the checklists yourself; the agent reports what it covered above.',
            }),
        );
        this.append(card);
    }

    learned(lessons: LessonView[]): void {
        const body = h('div', { class: 'card-body' });
        for (const lesson of lessons) {
            const row = h(
                'div',
                { class: 'lesson-item' },
                icon('check'),
                h('div', { class: 'lesson-main' }, h('div', { text: lesson.text }), h('div', { class: 'lesson-meta', text: lesson.scope === 'global' ? 'Applies to all projects' : 'Applies to this project' })),
            );
            const forget = button('Forget', 'ghost small', () => {
                send({ type: 'deleteLesson', id: lesson.id });
                row.classList.add('forgotten');
                forget.disabled = true;
            });
            row.append(forget);
            body.append(row);
        }
        body.append(
            h('p', { class: 'muted small', text: 'FreeAgentCoder will follow this in future tasks.' }),
            button('Manage memory', 'ghost small', () => openSettingsEvent('memory'), 'brain'),
        );
        this.body.append(h('div', { class: 'card learned' }, h('div', { class: 'card-head' }, icon('brain'), h('span', { class: 'card-title', text: 'Learned from your correction' })), body));
    }

    undone(message: Msg<'undone'>): void {
        this.disableUndo();
        const parts = [plural(message.restored.length, 'file restored', 'files restored'), plural(message.deleted.length, 'new file deleted', 'new files deleted')]
            .filter(Boolean)
            .join(', ');
        this.footer?.querySelectorAll('.file-row').forEach((row) => row.classList.add('reverted'));
        this.footer?.append(h('div', { class: 'notice info' }, icon('undo'), h('span', { text: `Changes undone${parts ? `: ${parts}` : ''}.` })));
    }

    disableUndo(): void {
        this.undoButton?.remove();
        this.undoButton = undefined;
    }

    dispose(): void {
        this.status?.dispose();
        clearTimeout(this.text?.timer);
    }

    private buildFooter(message: Msg<'turnEnd'>): HTMLElement {
        const outcomes: Record<TurnEndReason, [IconName, string, string]> = {
            completed: ['check', 'Done', 'ok'],
            max_steps: ['alert', 'Paused at the step limit', 'warn'],
            aborted: ['stop', 'Stopped', 'muted'],
            error: ['close', 'Failed', 'bad'],
        };
        const [iconName, label, tone] = outcomes[message.reason];
        const stats = [
            plural(message.steps, 'step'),
            formatDuration(message.durationMs),
            message.tokens > 0 ? `${compactNumber(message.tokens)} tokens` : '',
        ]
            .filter(Boolean)
            .join(' · ');
        const footer = h(
            'div',
            { class: `turn-end ${tone}` },
            h('div', { class: 'turn-end-line' }, icon(iconName), h('strong', { text: label }), h('span', { class: 'muted', text: stats })),
        );

        if (message.files.length) {
            const files = h('div', { class: 'files' }, h('div', { class: 'files-title', text: `${plural(message.files.length, 'file')} changed` }));
            for (const file of message.files) {
                files.append(
                    h(
                        'div',
                        { class: 'file-row' },
                        icon(file.created ? 'filePlus' : 'pencil'),
                        fileLink(file.path),
                        h('span', { class: 'stat' }, h('span', { class: 'add', text: `+${file.added}` }), h('span', { class: 'del', text: `−${file.removed}` })),
                        button('Diff', 'ghost small', () => send({ type: 'openDiff', diffId: file.diffId, title: file.path }), undefined, 'Open in the diff editor'),
                    ),
                );
            }
            files.addEventListener('click', handleContentClick);
            footer.append(files);
        }

        const actions = h('div', { class: 'turn-actions' });
        if (message.canUndo) {
            this.undoButton = button('Undo changes', 'secondary small', () => send({ type: 'undo', turnId: this.id }), 'undo', 'Restore the files changed in this task');
            actions.append(this.undoButton);
        }
        if (message.reason === 'max_steps') {
            actions.append(button('Continue', 'primary small', () => send({ type: 'continue' })));
        }
        if (message.reason === 'completed' || message.reason === 'max_steps') {
            actions.append(
                button('Point out a fix', 'ghost small', () => window.dispatchEvent(new CustomEvent('fac:correct')), 'target', 'Tell FreeAgentCoder exactly what is wrong. Attach a screenshot if it helps.'),
            );
        }
        if (actions.childElementCount) {
            footer.append(actions);
        }
        return footer;
    }

    private setStatus(text: string, attention = false): void {
        if (!this.status) {
            this.status = new StatusLine(this.startedAt);
            this.body.append(this.status.el);
        }
        this.status.set(text, attention);
    }

    private closeThinking(): void {
        if (this.thinking) {
            const ms = Date.now() - this.thinking.startedAt;
            this.thinking.label.textContent = ms >= 1_000 ? `Thought for ${formatDuration(ms)}` : 'Thought process';
            this.thinking = undefined;
        }
    }

    private closeGroup(): void {
        this.group?.close();
        this.group = undefined;
    }
}

class StatusLine {
    readonly el = h('div', { class: 'status-line' });
    private readonly label = h('span', { class: 'status-text' });
    private readonly time = h('span', { class: 'status-time' });
    private readonly timer: number;

    constructor(private readonly startedAt: number) {
        this.el.append(h('span', { class: 'spinner' }), this.label, this.time);
        this.timer = window.setInterval(() => this.tick(), 1_000);
        this.tick();
    }

    set(text: string, attention: boolean): void {
        this.label.textContent = text;
        this.el.classList.toggle('attention', attention);
    }

    dispose(): void {
        clearInterval(this.timer);
        this.el.remove();
    }

    private tick(): void {
        this.time.textContent = formatDuration(Date.now() - this.startedAt);
    }
}

class ExploreGroup {
    readonly el = h('details', { class: 'group', attrs: { open: '' } });
    private readonly title = h('span', { class: 'group-title' });
    private readonly count = h('span', { class: 'group-count' });
    private readonly rows = h('div', { class: 'group-rows' });
    private readonly items: RowCard[] = [];
    private active = true;

    constructor() {
        this.el.append(h('summary', {}, icon('chevron', 'caret'), icon('search'), this.title, this.count), this.rows);
        this.refresh();
    }

    add(message: Msg<'toolStart'>): RowCard {
        const row = new RowCard(message, false);
        this.items.push(row);
        this.rows.append(row.el);
        this.refresh();
        return row;
    }

    close(): void {
        this.active = false;
        this.el.open = false;
        this.refresh();
    }

    refresh(): void {
        const files = this.items.filter((i) => i.tool === 'read_file').length;
        const folders = this.items.filter((i) => i.tool === 'list_dir').length;
        const searches = this.items.length - files - folders;
        this.title.textContent = this.active ? 'Exploring' : 'Explored';
        this.count.textContent = [plural(files, 'file'), plural(searches, 'search', 'searches'), plural(folders, 'folder')].filter(Boolean).join(', ');
        this.el.classList.toggle('has-errors', this.items.some((i) => i.failed));
    }
}

class RowCard implements ToolView {
    readonly el: HTMLElement;
    readonly tool: string;
    failed = false;
    private done = false;
    private readonly state = h('span', { class: 'row-state' }, h('span', { class: 'spinner small' }));
    private readonly summary = h('span', { class: 'row-summary' });
    private readonly detail = h('div', { class: 'row-detail', hidden: true });

    constructor(message: Msg<'toolStart'>, standalone: boolean) {
        this.tool = message.tool;
        this.el = h(
            'div',
            { class: `tool-row${standalone ? ' standalone' : ''}` },
            h('div', { class: 'row-main' }, icon(toolIcon(message.tool)), h('span', { class: 'row-label', text: message.label, title: message.label }), this.summary, this.state),
            this.detail,
        );
    }

    output(): void {}

    end(message: Msg<'toolEnd'>): void {
        this.done = true;
        this.failed = !message.ok && !message.denied;
        const tone = message.denied ? 'denied' : message.ok ? 'ok' : 'failed';
        this.el.classList.add(tone);
        this.state.replaceChildren(icon(message.denied ? 'close' : message.ok ? 'check' : 'alert'));
        this.summary.textContent = message.denied ? 'Declined' : message.ok ? (message.summary ?? '') : 'Failed';
        if (this.failed && message.error) {
            this.detail.hidden = false;
            this.detail.textContent = message.error;
        }
    }

    cancel(): void {
        if (!this.done) {
            this.done = true;
            this.el.classList.add('denied');
            this.state.replaceChildren(icon('close'));
            this.summary.textContent = 'Stopped';
        }
    }
}

class EditCard implements ToolView {
    readonly el = h('div', { class: 'card edit' });
    private readonly kindIcon: HTMLElement;
    private readonly title = h('span', { class: 'card-title' });
    private readonly stats = h('span', { class: 'stat' });
    private readonly state = h('span', { class: 'row-state' }, h('span', { class: 'spinner small' }));
    private readonly body = h('div', { class: 'card-body', hidden: true });
    private done = false;

    constructor(message: Msg<'toolStart'>) {
        this.kindIcon = icon(toolIcon(message.tool));
        this.title.textContent = message.label;
        this.el.append(h('div', { class: 'card-head' }, this.kindIcon, this.title, this.stats, this.state), this.body);
        this.el.addEventListener('click', handleContentClick);
    }

    output(): void {}

    end(message: Msg<'toolEnd'>): void {
        this.done = true;
        if (message.denied) {
            this.el.classList.add('denied');
            this.state.replaceChildren(icon('close'));
            this.stats.textContent = 'Declined';
            return;
        }
        if (!message.ok) {
            this.el.classList.add('failed');
            this.state.replaceChildren(icon('alert'));
            this.body.hidden = false;
            this.body.append(h('pre', { class: 'error-text', text: message.error ?? 'The change could not be made.' }));
            return;
        }
        this.el.classList.add('ok');
        this.state.replaceChildren(icon('check'));
        const display = message.display;
        if (display?.type !== 'diff') {
            return;
        }
        this.kindIcon.replaceWith(icon(display.created ? 'filePlus' : 'pencil'));
        this.title.replaceChildren(h('span', { class: 'card-verb', text: display.created ? 'Created' : 'Edited' }), fileLink(display.path));
        this.stats.replaceChildren(h('span', { class: 'add', text: `+${display.added}` }), h('span', { class: 'del', text: `−${display.removed}` }));
        this.body.hidden = false;
        this.body.append(collapsible(renderDiff(display.lines, display.truncated), display.lines.length, 14));
        const diffId = message.diffId;
        if (diffId) {
            this.body.append(
                h('div', { class: 'card-actions' }, button('Open diff', 'ghost small', () => send({ type: 'openDiff', diffId, title: display.path }), 'external')),
            );
        }
    }

    cancel(): void {
        if (!this.done) {
            this.done = true;
            this.el.classList.add('denied');
            this.state.replaceChildren(icon('close'));
        }
    }
}

class CommandCard implements ToolView {
    readonly el = h('div', { class: 'card command' });
    private readonly badge = h('span', { class: 'badge info' }, h('span', { class: 'spinner small' }), h('span', { text: 'Running' }));
    private readonly command: HTMLElement;
    private readonly screen = h('pre', { class: 'terminal' });
    private readonly wrap = h('div', { class: 'terminal-wrap', hidden: true }, this.screen);
    private raw = '';
    private frame = 0;
    private done = false;

    constructor(message: Msg<'toolStart'>) {
        const text = message.label.replace(/^\$\s*/, '');
        this.command = h('code', { class: 'command-text', text, title: text });
        this.el.append(h('div', { class: 'card-head' }, icon('terminal'), h('span', { class: 'prompt', text: '$' }), this.command, this.badge), this.wrap);
    }

    output(chunk: string): void {
        this.raw = (this.raw + chunk.replace(ANSI, '')).slice(-20_000);
        this.paint();
    }

    end(message: Msg<'toolEnd'>): void {
        this.done = true;
        const display = message.display?.type === 'command' ? message.display : undefined;
        if (display) {
            this.command.textContent = display.command;
            this.command.title = display.command;
            this.raw = display.output.replace(ANSI, '');
        } else if (!message.ok && message.error) {
            this.raw = message.error;
        }
        this.paint();

        let text: string;
        let tone: string;
        if (message.denied) {
            [text, tone] = ['Declined', 'muted'];
        } else if (display?.background) {
            [text, tone] = ['Running in background', 'info'];
        } else if (display?.timedOut) {
            [text, tone] = ['Timed out', 'bad'];
        } else if (display && display.exitCode !== null) {
            [text, tone] = [`exit ${display.exitCode}`, display.exitCode === 0 ? 'ok' : 'bad'];
        } else {
            [text, tone] = message.ok ? ['Done', 'ok'] : ['Failed', 'bad'];
        }
        this.setBadge(text, tone);
    }

    cancel(): void {
        if (!this.done) {
            this.done = true;
            this.setBadge('Stopped', 'muted');
        }
    }

    private setBadge(text: string, tone: string): void {
        this.badge.className = `badge ${tone}`;
        this.badge.replaceChildren(icon(tone === 'ok' ? 'check' : tone === 'bad' ? 'alert' : tone === 'muted' ? 'close' : 'info'), h('span', { text }));
    }

    private paint(): void {
        if (this.frame) {
            return;
        }
        this.frame = requestAnimationFrame(() => {
            this.frame = 0;
            this.wrap.hidden = !this.raw.trim();
            this.screen.textContent = this.raw;
            this.screen.scrollTop = this.screen.scrollHeight;
        });
    }
}

class PlanCard {
    readonly el = h('div', { class: 'card plan' });
    private readonly count = h('span', { class: 'plan-count' });
    private readonly fill = h('div', { class: 'progress-fill' });
    private readonly items = h('ol', { class: 'plan-items' });

    constructor() {
        this.el.append(
            h('div', { class: 'card-head' }, icon('list'), h('span', { class: 'card-title', text: 'Plan' }), this.count),
            h('div', { class: 'progress' }, this.fill),
            this.items,
        );
    }

    update(todos: TodoView[]): void {
        const done = todos.filter((t) => t.status === 'completed').length;
        this.count.textContent = `${done} of ${todos.length} done`;
        this.fill.style.width = `${todos.length ? (done / todos.length) * 100 : 0}%`;
        this.items.replaceChildren(
            ...todos.map((todo) =>
                h(
                    'li',
                    { class: `todo ${todo.status}` },
                    todo.status === 'completed' ? icon('check') : todo.status === 'in_progress' ? h('span', { class: 'spinner small' }) : h('span', { class: 'todo-dot' }),
                    h('span', { class: 'todo-text', text: todo.content }),
                ),
            ),
        );
    }
}

function renderDiff(lines: DiffLineView[], truncated: boolean): HTMLElement {
    const el = h('div', { class: 'diff' });
    for (const line of lines) {
        if (line.kind === 'gap') {
            el.append(h('div', { class: 'diff-line gap', text: '⋯' }));
            continue;
        }
        el.append(
            h(
                'div',
                { class: `diff-line ${line.kind}` },
                h('span', { class: 'ln', text: line.line ? String(line.line) : '' }),
                h('span', { class: 'sign', text: line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' ' }),
                h('span', { class: 'code', text: line.text || ' ' }),
            ),
        );
    }
    if (truncated) {
        el.append(h('div', { class: 'diff-line gap', text: 'Diff shortened. Open the full diff to see every change.' }));
    }
    return el;
}

function collapsible(content: HTMLElement, lineCount: number, visible: number): HTMLElement {
    const wrap = h('div', { class: 'collapsible' }, content);
    if (lineCount <= visible) {
        return wrap;
    }
    wrap.classList.add('collapsed');
    const toggle = button(`Show all ${lineCount} lines`, 'link small', () => {
        const collapsed = wrap.classList.toggle('collapsed');
        const label = toggle.querySelector('span');
        if (label) {
            label.textContent = collapsed ? `Show all ${lineCount} lines` : 'Show less';
        }
    });
    wrap.append(toggle);
    return wrap;
}

function approvalCard(approval: ApprovalView): HTMLElement {
    const card = h('div', { class: `card approval${approval.dangerous ? ' danger' : ''}` });
    card.dataset.label = approval.command ?? approval.url ?? approval.label;

    const feedback = h('input', { class: 'input', attrs: { type: 'text', placeholder: 'What should it do instead? (optional)' } });
    const decide = (allow: boolean, remember = false) => {
        card.querySelectorAll('button').forEach((b) => (b.disabled = true));
        send({ type: 'approve', id: approval.id, allow, remember, feedback: allow ? undefined : feedback.value });
    };
    feedback.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            decide(false);
        }
    });
    const feedbackRow = h('div', { class: 'feedback-row', hidden: true }, feedback, button('Deny', 'secondary small', () => decide(false)));

    const body = h('div', { class: 'card-body' });
    if (approval.command) {
        body.append(h('pre', { class: 'command-box', text: `$ ${approval.command}` }));
    } else if (approval.url) {
        body.append(h('div', { class: 'approval-line' }, icon('globe'), h('span', { text: approval.url })));
    } else {
        body.append(h('div', { class: 'approval-line', text: approval.label }));
    }
    if (approval.preview?.type === 'diff') {
        body.append(collapsible(renderDiff(approval.preview.lines, approval.preview.truncated), approval.preview.lines.length, 12));
    }
    if (approval.outsideProject) {
        body.append(h('div', { class: 'notice warn' }, icon('alert'), h('span', { text: `Outside this project: ${approval.paths.join(', ')}` })));
    }
    const rememberLabel = approval.kind === 'write' ? 'Allow all edits' : approval.kind === 'network' ? 'Always allow this site' : 'Always allow';
    body.append(
        h(
            'div',
            { class: 'approval-actions' },
            button(approval.kind === 'exec' ? 'Run' : 'Allow', 'primary small', () => decide(true), 'check'),
            approval.canRemember ? button(rememberLabel, 'secondary small', () => decide(true, true), undefined, 'For the rest of this session') : null,
            button('Deny', 'secondary small', () => decide(false)),
            button('Deny with a note', 'link small', () => {
                feedbackRow.hidden = false;
                feedback.focus();
            }),
        ),
        feedbackRow,
    );

    card.append(
        h(
            'div',
            { class: 'card-head' },
            icon(approval.dangerous ? 'alert' : 'shield'),
            h('span', { class: 'card-title', text: approval.dangerous ? 'Review carefully' : 'Approval needed' }),
            h('span', { class: `badge ${approval.dangerous ? 'bad' : 'warn'}`, text: approval.reason }),
        ),
        body,
    );
    return card;
}

function errorCard(message: Msg<'error'>): HTMLElement {
    const [title, ...rest] = message.message.split('\n');
    const body = h('div', { class: 'card-body' });
    if (rest.join('\n').trim()) {
        body.append(h('pre', { class: 'error-text', text: rest.join('\n').trim() }));
    }
    if (message.hint) {
        body.append(h('p', { class: 'hint', text: message.hint }));
    }
    if (message.action === 'openKeys') {
        body.append(button('Open API Keys', 'primary small', () => openSettingsEvent('keys'), 'key'));
    } else if (message.action === 'openFolder') {
        body.append(button('Open Folder', 'primary small', () => send({ type: 'openFolder' }), 'folder'));
    }
    return h('div', { class: 'card error-card' }, h('div', { class: 'card-head' }, icon('alert'), h('span', { class: 'card-title', text: title })), body);
}
