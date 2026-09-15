import { useEffect, useRef, useState } from 'react';
import { Mark, useReducedMotion } from './ui';

interface Beat {
  label: string;
  /** How long this beat stays on screen before the next one, in ms. */
  hold: number;
}

const BEATS: Beat[] = [
  { label: 'You ask for a change', hold: 1500 },
  { label: 'It makes a plan', hold: 1700 },
  { label: 'Reading src/pages/Signup.tsx', hold: 700 },
  { label: 'Reading src/lib/validate.ts', hold: 700 },
  { label: 'Reading tests/signup.test.ts', hold: 1000 },
  { label: 'Editing src/lib/validate.ts', hold: 2400 },
  { label: 'Updating tests/signup.test.ts', hold: 1200 },
  { label: 'Running npm test', hold: 1300 },
  { label: 'Tests passed', hold: 1300 },
  { label: 'Running lint and type check', hold: 1600 },
  { label: 'All checks passed', hold: 0 },
];
const LAST = BEATS.length - 1;

const CHAPTERS = [
  { label: 'Prompt', beat: 0 },
  { label: 'Plan', beat: 1 },
  { label: 'Read files', beat: 2 },
  { label: 'Edit code', beat: 5 },
  { label: 'Run tests', beat: 7 },
  { label: 'Quality report', beat: 10 },
];

const PLAN = [
  { text: 'Find the signup form and its tests', doneAt: 5 },
  { text: 'Validate email and password', doneAt: 6 },
  { text: 'Cover the new rules in tests', doneAt: 7 },
  { text: 'Run tests, lint and type check', doneAt: 10 },
];

const FILES = ['src/pages/Signup.tsx', 'src/lib/validate.ts', 'tests/signup.test.ts'];

const DIFF: { n: string; kind: 'ctx' | 'add' | 'del'; text: string }[] = [
  { n: '12', kind: 'ctx', text: 'export function validateSignup(input: SignupInput) {' },
  { n: '13', kind: 'del', text: '  return EMAIL.test(input.email);' },
  { n: '13', kind: 'add', text: '  const errors: string[] = [];' },
  { n: '14', kind: 'add', text: "  if (!EMAIL.test(input.email)) errors.push('Enter a valid email');" },
  { n: '15', kind: 'add', text: "  if (input.password.length < 8) errors.push('Use 8+ characters');" },
  { n: '16', kind: 'add', text: '  return errors;' },
  { n: '17', kind: 'ctx', text: '}' },
];

const SIGN = { ctx: ' ', add: '+', del: '−' } as const;

export function Demo() {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Reduced motion: show the finished task and never autoplay.
  useEffect(() => {
    if (reduced) {
      setStep(LAST);
      setPlaying(false);
      setStarted(true);
    }
  }, [reduced]);

  // Autoplay once, the first time the demo scrolls into view.
  useEffect(() => {
    if (reduced || started) return;
    const node = rootRef.current;
    if (!node || !('IntersectionObserver' in window)) {
      setStarted(true);
      setPlaying(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setStarted(true);
          setPlaying(true);
          observer.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [reduced, started]);

  // Advance through the script.
  useEffect(() => {
    if (!playing) return;
    if (step >= LAST) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setStep((current) => Math.min(current + 1, LAST)), BEATS[step].hold);
    return () => window.clearTimeout(timer);
  }, [playing, step]);

  // Keep the newest message in view inside the panel only (never scrolls the page).
  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTo({ top: body.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
  }, [step, reduced]);

  const jump = (beat: number) => {
    setStarted(true);
    setPlaying(false);
    setStep(beat);
  };
  const toggle = () => {
    setStarted(true);
    if (!playing && step >= LAST) {
      setStep(0);
      setPlaying(true);
      return;
    }
    setPlaying((value) => !value);
  };
  const restart = () => {
    setStarted(true);
    setStep(0);
    setPlaying(true);
  };

  const chapter = CHAPTERS.reduce((current, item, index) => (step >= item.beat ? index : current), 0);
  const doneCount = PLAN.filter((item) => step >= item.doneAt).length;
  const doingIndex = step >= 1 && step < LAST ? doneCount : -1;
  const filesRead = Math.max(0, Math.min(step - 1, FILES.length));
  const running = step < LAST && playing;

  return (
    <div className="demo" ref={rootRef}>
      <div className="demo-side">
        <ol className="demo-steps" aria-label="Demo steps">
          {CHAPTERS.map((item, index) => {
            const state = index < chapter || (index === chapter && step >= LAST) ? 'done' : index === chapter ? 'current' : 'todo';
            return (
              <li key={item.label}>
                <button type="button" className={`demo-step is-${state}`} aria-current={index === chapter ? 'step' : undefined} onClick={() => jump(item.beat)}>
                  <span className="demo-step-n" aria-hidden="true">
                    {state === 'done' ? '✓' : String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="demo-step-label">{item.label}</span>
                  <span className="demo-step-state">
                    {state === 'done' ? 'Done' : state === 'current' ? 'Now' : <span className="sr-only">Upcoming</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="demo-note">A scripted replay of a typical task. Real runs vary by model, project and permission mode.</p>
      </div>

      <div className="demo-main">
        <div className="demo-controls">
          <button type="button" className="btn btn-primary btn-sm demo-toggle" onClick={toggle}>
            <span aria-hidden="true">{playing ? '❚❚' : step >= LAST ? '↺' : '▶'}</span>
            {playing ? 'Pause' : step >= LAST ? 'Replay' : 'Play'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={restart}>
            Restart
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => jump(LAST)} disabled={step >= LAST}>
            Skip to end
          </button>
          <p className="demo-status" aria-live={playing ? 'off' : 'polite'}>
            <span className="mono">
              {String(step + 1).padStart(2, '0')}/{BEATS.length}
            </span>{' '}
            {BEATS[step].label}
          </p>
        </div>
        <div className="demo-bar" aria-hidden="true">
          {BEATS.map((beat, index) => (
            <span key={beat.label} className={index <= step ? 'is-on' : undefined} />
          ))}
        </div>

        <figure className="panel" aria-label="Mock of the FreeAgentCoder chat panel in VS Code">
          <div className="panel-bar">
            <span className="panel-title">
              <Mark size={14} /> FreeAgentCoder
            </span>
            <span className="chip">Auto-edit</span>
          </div>

          <div className="panel-body" ref={bodyRef} tabIndex={0} aria-label="Chat transcript">
            <div className="p-user beat">Add email and password validation to the signup form, then make sure the tests pass.</div>

            {step >= 1 && (
              <>
                <div className="p-agent beat">
                  <Mark size={14} /> FreeAgentCoder
                  <span className="chip">Deep</span>
                  <span className="chip">Gemini · Personal</span>
                </div>
                <div className="p-box beat">
                  <div className="p-head">
                    <span>Plan</span>
                    <span className="muted mono">{doneCount} / 4</span>
                  </div>
                  <div className="p-progress" data-done={doneCount}>
                    <span />
                  </div>
                  <ul className="p-todos">
                    {PLAN.map((item, index) => {
                      const state = step >= item.doneAt ? 'done' : index === doingIndex ? 'doing' : 'todo';
                      return (
                        <li key={item.text} className={state}>
                          <span className="p-check" aria-hidden="true">
                            {state === 'done' ? '[x]' : state === 'doing' ? '[~]' : '[ ]'}
                          </span>
                          <span className="sr-only">{state === 'done' ? 'Done: ' : state === 'doing' ? 'In progress: ' : 'To do: '}</span>
                          <span className="p-todo-text">{item.text}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </>
            )}

            {step >= 2 && (
              <div className="p-box beat">
                <div className="p-head">
                  <span>
                    <span className="muted">›</span> Explored
                  </span>
                  <span className="muted mono">
                    {filesRead} {filesRead === 1 ? 'file' : 'files'}
                  </span>
                </div>
                <ul className="p-files">
                  {FILES.slice(0, filesRead).map((file) => (
                    <li key={file} className="beat">
                      <span className="muted">Read</span> <code>{file}</code>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {step >= 5 && (
              <div className="p-box beat">
                <div className="p-head">
                  <span>
                    <span className="muted">Edited</span> <code>src/lib/validate.ts</code>
                  </span>
                  <span className="mono">
                    <span className="n-add">+4</span> <span className="n-del">−1</span>
                  </span>
                </div>
                <div className="p-diff" tabIndex={0} aria-label="Diff of src/lib/validate.ts">
                  {DIFF.map((line, index) => (
                    <div key={index} className={`ln ${line.kind}`}>
                      <i>{line.n}</i>
                      <b>{SIGN[line.kind]}</b>
                      <span className="sr-only">{line.kind === 'add' ? 'added: ' : line.kind === 'del' ? 'removed: ' : ''}</span>
                      <span className="code">{line.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {step >= 6 && (
              <div className="p-line beat">
                <span className="muted">Edited</span> <code>tests/signup.test.ts</code> <span className="n-add mono">+18</span>
              </div>
            )}

            {step >= 7 && (
              <div className="p-box beat">
                <div className="p-head mono">
                  <span>$ npm test</span>
                  {step >= 8 ? <span className="badge">exit 0</span> : <span className="badge is-running">running</span>}
                </div>
                <pre className="p-term">
                  {step >= 8
                    ? ' ✓ tests/validate.test.ts (4 tests)\n ✓ tests/signup.test.ts (6 tests)\n\n Tests  10 passed (10)'
                    : ' Running 2 test files…'}
                </pre>
              </div>
            )}

            {step >= 9 && (
              <div className="p-box beat">
                <div className="p-head mono">
                  <span>$ npm run lint</span>
                  <span className="badge">exit 0</span>
                </div>
                <div className="p-head mono">
                  <span>$ npx tsc --noEmit</span>
                  <span className="badge">exit 0</span>
                </div>
              </div>
            )}

            {step >= 10 && (
              <>
                <div className="p-report beat">
                  <div className="p-head">
                    <span>Quality report</span>
                    <span className="badge is-solid">All checks passed</span>
                  </div>
                  <ul className="p-checks">
                    <li>
                      <span className="tick" aria-hidden="true">
                        ✓
                      </span>
                      Tests <span className="muted">10 passed</span>
                    </li>
                    <li>
                      <span className="tick" aria-hidden="true">
                        ✓
                      </span>
                      Lint <span className="muted">no problems</span>
                    </li>
                    <li>
                      <span className="tick" aria-hidden="true">
                        ✓
                      </span>
                      Type check <span className="muted">no errors</span>
                    </li>
                  </ul>
                  <div className="p-foot">
                    <span>2 files changed</span>
                    <span className="p-undo" aria-hidden="true">
                      Undo
                    </span>
                  </div>
                </div>
                <div className="p-done beat">
                  <span className="tick" aria-hidden="true">
                    ✓
                  </span>{' '}
                  Done <span className="muted">· 12 steps · 41s</span>
                </div>
              </>
            )}
          </div>

          <div className="p-input" aria-hidden="true">
            <span>Ask FreeAgentCoder to build, fix or explain…</span>
            <span className="p-send">{running ? '■' : '↑'}</span>
          </div>
        </figure>
      </div>
    </div>
  );
}
