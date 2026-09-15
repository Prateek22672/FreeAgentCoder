import { useId, useState } from 'react';
import { LockIcon } from './ui';

const SIZES = [
  { id: 'small', label: 'Small', requests: 3, example: 'Questions, renames and one-file fixes.' },
  { id: 'medium', label: 'Medium', requests: 10, example: 'A feature or bug fix across a few files.' },
  { id: 'large', label: 'Large', requests: 30, example: 'New apps, big refactors and Senior-mode builds.' },
] as const;

type SizeId = (typeof SIZES)[number]['id'];

const HEADROOM = 0.2;
const DEFAULT_PROMPTS = 40;
const DEFAULT_ALLOWANCE = 250;
const MAX_SQUARES = 24;

const fmt = (n: number) => new Intl.NumberFormat('en').format(n);

export function KeyCalculator() {
  const [prompts, setPrompts] = useState(DEFAULT_PROMPTS);
  const [sizeId, setSizeId] = useState<SizeId>('medium');
  const [allowanceText, setAllowanceText] = useState(String(DEFAULT_ALLOWANCE));
  const id = useId();

  const size = SIZES.find((item) => item.id === sizeId) ?? SIZES[1];
  const allowance = Number(allowanceText);
  const valid = allowanceText.trim() !== '' && Number.isInteger(allowance) && allowance >= 1 && allowance <= 1_000_000;
  const daily = prompts * size.requests;
  const needed = Math.ceil(daily * (1 + HEADROOM));
  const exact = valid ? needed / allowance : 0;
  const keys = valid ? Math.max(1, Math.ceil(exact)) : null;
  const share = keys ? Math.round((needed / keys / allowance) * 100) : 0;

  return (
    <div className="calc">
      <form className="calc-inputs" onSubmit={(event) => event.preventDefault()} aria-label="Your usage">
        <div className="field">
          <div className="field-head">
            <label htmlFor={`${id}-prompts`}>Prompts per day</label>
            <output htmlFor={`${id}-prompts`} className="field-value">
              {prompts}
            </output>
          </div>
          <input
            id={`${id}-prompts`}
            className="range"
            type="range"
            min={5}
            max={300}
            step={5}
            value={prompts}
            onChange={(event) => setPrompts(Number(event.target.value))}
          />
          <div className="range-scale" aria-hidden="true">
            <span>5</span>
            <span>150</span>
            <span>300</span>
          </div>
        </div>

        <fieldset className="field">
          <legend>Typical task size</legend>
          <div className="seg">
            {SIZES.map((item) => (
              <label key={item.id}>
                <input type="radio" name={`${id}-size`} value={item.id} checked={sizeId === item.id} onChange={() => setSizeId(item.id)} />
                <span>
                  {item.label}
                  <small>{item.requests} requests / prompt</small>
                </span>
              </label>
            ))}
          </div>
          <p className="hint">{size.example}</p>
        </fieldset>

        <div className="field">
          <label htmlFor={`${id}-allowance`}>Requests allowed per key, per day</label>
          <div className="num">
            <input
              id={`${id}-allowance`}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={allowanceText}
              aria-invalid={!valid}
              aria-describedby={`${id}-allowance-hint`}
              onChange={(event) => setAllowanceText(event.target.value)}
            />
            <span aria-hidden="true">req / day</span>
          </div>
          <p className="hint" id={`${id}-allowance-hint`}>
            {DEFAULT_ALLOWANCE} is only a starting point. <strong>Check your provider’s current free-tier limits</strong>; they differ by provider and model, and change often.
          </p>
        </div>

        <p className="note">
          <LockIcon />
          <span>
            <strong>Your API keys stay on your device.</strong> They are stored encrypted in VS Code's Secret Storage (your operating system's keychain) and are sent only
            to the provider each key belongs to when you run a task. <a href="#privacy">How keys are stored</a>
          </span>
        </p>
      </form>

      <div className="calc-result">
        <p className="label">Estimate</p>
        {keys !== null ? (
          <>
            <p className="result-num" aria-live="polite">
              <strong>{keys}</strong>
              <span>{keys === 1 ? 'key recommended' : 'keys recommended'}</span>
            </p>
            <ul className="keys-grid" aria-hidden="true">
              {Array.from({ length: Math.min(keys, MAX_SQUARES) }, (_, index) => (
                <li key={index} />
              ))}
              {keys > MAX_SQUARES && <li className="more">+{keys - MAX_SQUARES}</li>}
            </ul>
            <p className="result-text">
              {keys === 1
                ? `One key covers about ${fmt(needed)} requests a day, using roughly ${share}% of its allowance. A second key is still useful as a fallback when the first hits a per-minute limit.`
                : `You'd use about ${fmt(needed)} requests a day. Spread across ${keys} keys, each uses roughly ${share}% of its daily allowance. Keys from different providers also give smart routing more to choose from.`}
            </p>
            <dl className="math">
              <div>
                <dt>Prompts per day</dt>
                <dd>{fmt(prompts)}</dd>
              </div>
              <div>
                <dt>× Requests per prompt ({size.label.toLowerCase()})</dt>
                <dd>{size.requests}</dd>
              </div>
              <div>
                <dt>= Requests per day</dt>
                <dd>{fmt(daily)}</dd>
              </div>
              <div>
                <dt>+ {HEADROOM * 100}% headroom for retries</dt>
                <dd>{fmt(needed)}</dd>
              </div>
              <div>
                <dt>÷ Requests per key</dt>
                <dd>{fmt(allowance)}</dd>
              </div>
              <div className="math-total">
                <dt>= Keys, rounded up</dt>
                <dd>
                  {exact.toFixed(2)} → {keys}
                </dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="field-error" role="alert">
            Enter a whole number of requests per key per day (1 or more) to see an estimate.
          </p>
        )}
      </div>

      <div className="calc-foot">
        <p className="label">Assumptions</p>
        <ul className="checks checks-sm">
          <li>This is an estimate, not a guarantee. Real request counts depend on your project, the model and the task.</li>
          <li>
            An agent makes several model requests per prompt: planning, reading, editing and checking. Small = {SIZES[0].requests}, Medium = {SIZES[1].requests}, Large ={' '}
            {SIZES[2].requests} requests per prompt.
          </li>
          <li>{HEADROOM * 100}% headroom is added for retries and tasks that run longer than usual.</li>
          <li>Per-minute limits aren’t included. When one is hit, your next key takes over, or the task waits and resumes.</li>
        </ul>
      </div>
    </div>
  );
}
