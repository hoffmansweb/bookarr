// Small accessible building blocks for the Settings pages: every control gets a real
// <label>, help text is linked via aria-describedby, and on/off options are switches.
import React, { useId } from 'react';

export const Card = ({ title, description, actions, children }) => (
  <section className="s-card">
    {(title || actions) && (
      <header className="s-card__header">
        <div>
          {title && <h3 className="s-card__title">{title}</h3>}
          {description && <p className="s-card__desc">{description}</p>}
        </div>
        {actions && <div className="s-card__actions">{actions}</div>}
      </header>
    )}
    <div className="s-card__body">{children}</div>
  </section>
);

export const Field = ({ label, help, children, wide }) => {
  const id = useId();
  const helpId = help ? `${id}-help` : undefined;
  const child = React.Children.only(children);
  return (
    <div className={`s-field${wide ? ' s-field--wide' : ''}`}>
      <label className="s-field__label" htmlFor={id}>{label}</label>
      {React.cloneElement(child, { id, 'aria-describedby': helpId })}
      {help && <p className="s-field__help" id={helpId}>{help}</p>}
    </div>
  );
};

export const TextInput = ({ value, onChange, type = 'text', ...rest }) => (
  <input
    className="s-input"
    type={type}
    value={value ?? ''}
    autoComplete={type === 'password' ? 'new-password' : 'off'}
    onChange={(e) => onChange(e.target.value)}
    {...rest}
  />
);

export const Select = ({ value, onChange, options, ...rest }) => (
  <select className="s-input" value={value ?? options[0]?.value} onChange={(e) => onChange(e.target.value)} {...rest}>
    {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
);

// On/off switch backed by a native checkbox (keyboard + screen reader friendly)
export const Switch = ({ label, help, checked, onChange }) => {
  const id = useId();
  return (
    <div className="s-switch-row">
      <div>
        <label htmlFor={id} className="s-field__label">{label}</label>
        {help && <p className="s-field__help" id={`${id}-help`}>{help}</p>}
      </div>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="s-switch"
        checked={!!checked}
        aria-describedby={help ? `${id}-help` : undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
    </div>
  );
};

// Settings stored as strings ('true'/'false') in the settings table
export const settingBool = (settings, key, fallback = true) =>
  settings[key] === undefined || settings[key] === null || settings[key] === '' ? fallback : settings[key] !== 'false';

export const Badge = ({ tone = 'neutral', children }) => <span className={`s-badge s-badge--${tone}`}>{children}</span>;

export const Grid = ({ children }) => <div className="s-grid">{children}</div>;
