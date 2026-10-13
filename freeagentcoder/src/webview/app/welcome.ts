import type { ToWebview } from '../../shared/protocol';
import { compactNumber } from '../../shared/format';
import { crocsLink } from './crocs';
import { button, h, send } from './dom';
import { icon } from './icons';

/**
 * The welcome popup: on a fresh install and once after a release with news.
 * It shows what is new, a one-time token bonus (a gift, never tied to the
 * sharing choice), and the choice to share what the agent learns:
 * "OK, start using the agent" shares, "Close" (or Esc) does not.
 */

type Welcome = Extract<ToWebview, { type: 'welcome' }>;

const NEWS = [
    'Simple questions and small talk use about 90% fewer tokens.',
    'CROCS Security hides keys and passwords from the model.',
    'Sites, decks and documents are checked before they are called done.',
];

let open: HTMLElement | undefined;
let bonusRow: HTMLElement | undefined;

export function openWelcome(data: Welcome, onDone: (share: boolean) => void): void {
    if (open) {
        return;
    }
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const sharingOn = data.sharing === 'on';
    const blocked = data.sharing === 'blocked';
    const finish = (share: boolean) => {
        overlay.remove();
        open = undefined;
        bonusRow = undefined;
        document.removeEventListener('keydown', onKey, true);
        // Someone already sharing keeps sharing whichever button they press.
        const choice = sharingOn ? true : share;
        send({ type: 'welcomeChoice', share: choice });
        onDone(choice);
        returnFocus?.focus();
    };
    const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            finish(false);
        } else if (event.key === 'Tab') {
            const focusable = [...dialog.querySelectorAll<HTMLElement>('button, a[href]')].filter((el) => !el.hasAttribute('disabled'));
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
            }
        }
    };

    bonusRow = renderBonus(data.bonus);
    const see = h('button', { class: 'link-button', attrs: { type: 'button' }, text: 'See exactly what is sent' });
    see.addEventListener('click', () => send({ type: 'showShared' }));
    const close = h('button', { class: 'link-button welcome-close', attrs: { type: 'button' }, text: 'Close' });
    close.addEventListener('click', () => finish(false));
    const primary = button(sharingOn || blocked ? 'Continue' : 'OK, start using the agent', 'primary', () => finish(true), 'check');

    const dialog = h(
        'div',
        { class: 'crocs-dialog welcome-dialog', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'welcome-title' } },
        h(
            'div',
            { class: 'crocs-head' },
            h('span', { class: 'crocs-badge' }, icon('spark')),
            h(
                'div',
                {},
                h('h2', { attrs: { id: 'welcome-title' }, text: data.update ? `What’s new in FreeAgentCoder ${data.version}` : 'Welcome to FreeAgentCoder' }),
                h('div', { class: 'crocs-sub', text: data.update ? 'Your keys, chats and settings are kept.' : 'A free AI coding agent that plans, edits, runs and tests your code.' }),
            ),
        ),
        data.update ? h('ul', { class: 'welcome-news' }, ...NEWS.map((line) => h('li', {}, icon('check'), h('span', { text: line })))) : null,
        bonusRow,
        blocked
            ? null
            : h(
                  'section',
                  { class: 'welcome-share' },
                  h('h3', { text: sharingOn ? 'You are helping make it smarter' : 'Make FreeAgentCoder smarter, for you and everyone' }),
                  h('p', {
                      class: 'muted',
                      text: sharingOn
                          ? 'Thank you: the lessons from your corrections help every user, and theirs come back to you. Never your code, files or prompts.'
                          : 'When you correct it or a task fails, the lesson (never your code, files or prompts) helps the agent avoid that mistake for every user, and shared lessons come back to you.',
                  }),
                  h('p', { class: 'muted small' }, icon('lock'), ' Names, paths and secrets are removed on your computer first. ', see),
              ),
        h('div', { class: 'share-actions' }, primary, sharingOn || blocked ? null : close),
        h(
            'p',
            { class: 'muted small welcome-foot' },
            sharingOn || blocked ? 'Change sharing any time in Settings → Learning. ' : 'Sharing starts only if you choose OK. Change it any time in Settings → Learning. ',
            crocsLink('How CROCS Security protects you'),
        ),
    );
    const overlay = h('div', { class: 'crocs-overlay' }, dialog);
    document.body.append(overlay);
    open = overlay;
    document.addEventListener('keydown', onKey, true);
    primary.focus();
}

function renderBonus(bonus: Welcome['bonus']): HTMLElement | undefined {
    if (!bonus.offered && !bonus.left) {
        return undefined;
    }
    const row = h('div', { class: 'welcome-bonus' });
    const paint = (state: { claimed: boolean; left: number; error?: string }) => {
        const amount = compactNumber(state.claimed ? state.left : bonus.offered);
        row.replaceChildren(
            h('span', { class: 'welcome-gift', text: '🎁' }),
            h(
                'div',
                { class: 'welcome-bonus-text' },
                h('strong', { text: state.claimed ? `${amount} bonus tokens are yours` : `${amount} bonus tokens, free` }),
                h('span', {
                    class: 'muted',
                    text: state.error ?? 'Used automatically when your own keys or today’s free trial run out, so a task can carry on. Runs through the FreeAgentCoder trial; what you send is not stored.',
                }),
            ),
            state.claimed
                ? h('span', { class: 'welcome-claimed' }, icon('check'), 'Added')
                : button(`Claim ${amount}`, 'primary small', () => {
                      claim.disabled = true;
                      send({ type: 'claimBonus' });
                  }),
        );
        const claim = row.querySelector('button') as HTMLButtonElement;
    };
    paint({ claimed: bonus.claimed && bonus.left > 0, left: bonus.left });
    (row as HTMLElement & { paint?: typeof paint }).paint = paint;
    return row;
}

/** The answer to a claim, from the extension. */
export function bonusClaimed(result: Extract<ToWebview, { type: 'bonus' }>): void {
    const paint = (bonusRow as (HTMLElement & { paint?: (s: { claimed: boolean; left: number; error?: string }) => void }) | undefined)?.paint;
    if (!paint) {
        return;
    }
    paint(result.ok ? { claimed: true, left: result.tokens } : { claimed: false, left: 0, error: result.reason ?? 'The bonus could not be claimed right now.' });
}
