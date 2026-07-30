import { useState } from "react";
import { ChevronRight } from "lucide-react";

interface Props {
  title: string;
  defaultOpen: boolean;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}

export function SettingsSection({ title, defaultOpen, headerRight, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="settings-card">
      <div className="settings-card__header">
        <button
          type="button"
          className="settings-card__title-btn"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <h2 className="settings-card__title">
            <ChevronRight
              className={`settings-chevron${open ? " is-open" : ""}`}
              size={15}
              strokeWidth={2.25}
              aria-hidden="true"
            />
            {title}
          </h2>
        </button>
        {headerRight && (
          <div onClick={(e) => e.stopPropagation()}>{headerRight}</div>
        )}
      </div>
      <div className={`collapsible${open ? " is-open" : ""}`} aria-hidden={!open}>
        <div className="collapsible__inner">{children}</div>
      </div>
    </section>
  );
}
