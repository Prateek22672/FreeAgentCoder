import { useState } from 'react';
import { FEATURES } from './content';
import { handleTabKeys } from './ui';

const pad = (n: number) => String(n).padStart(2, '0');

export function FeatureExplorer() {
  const [active, setActive] = useState(0);
  const feature = FEATURES[active];
  const count = FEATURES.length;

  return (
    <div className="explorer">
      <div className="explorer-list" role="tablist" aria-orientation="vertical" aria-label="Features">
        {FEATURES.map((item, index) => (
          <button
            key={item.id}
            id={`feature-tab-${index}`}
            type="button"
            role="tab"
            className="explorer-tab"
            aria-selected={index === active}
            aria-controls="feature-panel"
            tabIndex={index === active ? 0 : -1}
            onClick={() => setActive(index)}
            onKeyDown={(event) => handleTabKeys(event, index, count, 'feature', setActive, 'vertical')}
          >
            <span className="explorer-num" aria-hidden="true">
              {pad(index + 1)}
            </span>
            <span>{item.title}</span>
          </button>
        ))}
      </div>

      <div className="explorer-panel" id="feature-panel" role="tabpanel" aria-labelledby={`feature-tab-${active}`} tabIndex={0}>
        <p className="label">
          <span className="index">
            {pad(active + 1)} / {pad(count)}
          </span>
          {feature.tag}
        </p>
        <h3>{feature.title}</h3>
        <p className="explorer-summary">{feature.summary}</p>
        <ul className="checks">
          {feature.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        {feature.where && (
          <p className="explorer-where">
            <span className="label">Find it in</span> {feature.where}
          </p>
        )}
        <div className="explorer-nav">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setActive((active - 1 + count) % count)}>
            <span aria-hidden="true">←</span> Previous
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setActive((active + 1) % count)}>
            Next <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </div>
  );
}
