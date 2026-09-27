// Download source priority: ordered, toggleable lists per format. Saved as JSON in
// settings source_order_ebook / source_order_audiobook (via the page-level Save bar).
import React, { useEffect, useState } from 'react';
import api from '../../../services/api';
import { Card } from '../ui';

const PriorityList = ({ format, items, onChange }) => {
  const move = (i, delta) => {
    const next = [...items];
    const j = i + delta;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const toggle = (i) => onChange(items.map((s, k) => (k === i ? { ...s, enabled: !s.enabled } : s)));
  let rank = 0;

  return (
    <ol className="s-priority" aria-label={`${format} source order`}>
      {items.map((s, i) => {
        if (s.enabled) rank += 1;
        return (
          <li key={s.id} className={`s-priority__item${s.enabled ? '' : ' is-off'}`}>
            <span className="s-priority__rank" aria-hidden="true">{s.enabled ? rank : '–'}</span>
            <div className="s-priority__text">
              <span className="s-priority__label">{s.label}</span>
              <span className="s-field__help">{s.help}</span>
            </div>
            <div className="s-priority__controls">
              <button type="button" className="s-btn s-btn--icon" onClick={() => move(i, -1)} disabled={i === 0}
                aria-label={`Move ${s.label} up`}>↑</button>
              <button type="button" className="s-btn s-btn--icon" onClick={() => move(i, 1)} disabled={i === items.length - 1}
                aria-label={`Move ${s.label} down`}>↓</button>
              <input
                type="checkbox"
                role="switch"
                className="s-switch"
                checked={s.enabled}
                onChange={() => toggle(i)}
                aria-label={`Use ${s.label}`}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
};

const PrioritySection = ({ settings, set }) => {
  const [orders, setOrders] = useState(null);

  // Server resolves defaults + any sources added since the list was saved
  useEffect(() => {
    api.get('/nzb/source-order').then(({ data }) => setOrders(data)).catch(() => setOrders({ ebook: [], audiobook: [] }));
  }, []);

  // Keep in sync if settings are re-imported / discarded
  useEffect(() => {
    if (!orders) return;
    const apply = (fmt) => {
      try {
        const saved = JSON.parse(settings[`source_order_${fmt}`] || 'null');
        if (!Array.isArray(saved)) return orders[fmt];
        const byId = Object.fromEntries(orders[fmt].map(s => [s.id, s]));
        const merged = saved.filter(s => byId[s.id]).map(s => ({ ...byId[s.id], enabled: s.enabled !== false }));
        return [...merged, ...orders[fmt].filter(s => !merged.find(m => m.id === s.id))];
      } catch (e) {
        return orders[fmt];
      }
    };
    const next = { ebook: apply('ebook'), audiobook: apply('audiobook') };
    if (JSON.stringify(next) !== JSON.stringify(orders)) setOrders(next);
  }, [settings.source_order_ebook, settings.source_order_audiobook]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (fmt, list) => {
    setOrders({ ...orders, [fmt]: list });
    set(`source_order_${fmt}`, JSON.stringify(list.map(({ id, enabled }) => ({ id, enabled }))));
  };

  if (!orders) return <p className="s-muted">Loading…</p>;

  return (
    <>
      <p className="s-intro">
        Bookarr tries sources from top to bottom. If a source finds nothing, or its download fails (a dead link,
        a fake 2-minute "full audiobook" upload), it moves on to the next one automatically.
        Used by <strong>Get</strong>, <strong>Auto Audiobook</strong> and the scheduled auto-search.
      </p>
      <Card title="📖 Ebooks">
        <PriorityList format="Ebook" items={orders.ebook} onChange={(l) => update('ebook', l)} />
      </Card>
      <Card title="🎧 Audiobooks" description="Put YouTube first for speed; Usenet/torrent releases are usually the best quality.">
        <PriorityList format="Audiobook" items={orders.audiobook} onChange={(l) => update('audiobook', l)} />
      </Card>
    </>
  );
};

export default PrioritySection;
