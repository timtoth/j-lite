import { useEffect, useMemo, useState } from "react";
import { useCombobox } from "downshift";
import { JiraProjectSummary } from "../types";
import { fetchJiraProjects } from "../api";

export interface SpaceModalProps {
  knownSpaces: string[];
  detectedSpaces: string[];
  onConfirm: (space: string) => void;
  onCancel: () => void;
}

const MAX_SUGGESTIONS = 8;

export function SpaceModal({ knownSpaces, detectedSpaces, onConfirm, onCancel }: SpaceModalProps) {
  const initial = (detectedSpaces[0] ?? knownSpaces[0] ?? "").toString();
  const [inputValue, setInputValue] = useState(initial);
  const [projects, setProjects] = useState<JiraProjectSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const isMulti = detectedSpaces.length > 1;

  useEffect(() => {
    let cancelled = false;
    fetchJiraProjects()
      .then((res) => { if (!cancelled) setProjects(res.projects); })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load projects");
        setProjects([]);
      });
    return () => { cancelled = true; };
  }, []);

  const items = useMemo<JiraProjectSummary[]>(() => {
    const base = projects ?? [];
    const known = new Set([...detectedSpaces, ...knownSpaces].map((k) => k.toUpperCase()));
    const knownItems: JiraProjectSummary[] = [...detectedSpaces, ...knownSpaces]
      .filter((k, i, arr) => arr.indexOf(k) === i)
      .map((k) => {
        const found = base.find((p) => p.key.toUpperCase() === k.toUpperCase());
        return found ?? { key: k, name: "" };
      });
    const others = base.filter((p) => !known.has(p.key.toUpperCase()));
    const all = [...knownItems, ...others];

    const q = inputValue.trim().toUpperCase();
    if (!q) return all.slice(0, MAX_SUGGESTIONS);
    const matches = all.filter(
      (p) => p.key.toUpperCase().includes(q) || (p.name && p.name.toUpperCase().includes(q)),
    );
    matches.sort((a, b) => {
      const aStarts = a.key.toUpperCase().startsWith(q) ? 0 : 1;
      const bStarts = b.key.toUpperCase().startsWith(q) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return a.key.localeCompare(b.key);
    });
    return matches.slice(0, MAX_SUGGESTIONS);
  }, [projects, knownSpaces, detectedSpaces, inputValue]);

  function handleConfirm(raw?: string) {
    const chosen = (raw ?? inputValue).trim();
    if (!chosen) return;
    onConfirm(chosen.toUpperCase());
  }

  const {
    isOpen,
    getMenuProps,
    getInputProps,
    getItemProps,
    highlightedIndex,
  } = useCombobox<JiraProjectSummary>({
    items,
    inputValue,
    itemToString: (item) => (item ? item.key : ""),
    onInputValueChange: ({ inputValue: next }) => setInputValue(next ?? ""),
    onSelectedItemChange: ({ selectedItem }) => {
      if (selectedItem) handleConfirm(selectedItem.key);
    },
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const inputProps = getInputProps({
    placeholder: "Project key or name",
    autoFocus: true,
    autoComplete: "off",
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && highlightedIndex < 0) {
        e.preventDefault();
        handleConfirm();
      }
    },
  });

  return (
    <div className="space-modal__backdrop" onClick={onCancel}>
      <div className="space-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="space-modal__title">
          {isMulti ? "Which JIRA space is the primary one?" : "Which JIRA space?"}
        </h2>
        <p className="space-modal__hint">
          {isMulti
            ? `You referenced ${detectedSpaces.join(", ")}. Pick the primary one for this instruction.`
            : "Pick the JIRA space this instruction should run against."}
        </p>

        <div className="space-modal__combo">
          <input className="space-modal__free-text" {...inputProps} />
          <ul
            {...getMenuProps()}
            className="space-modal__suggestions"
            hidden={!isOpen || items.length === 0}
          >
            {isOpen && items.map((p, i) => (
              <li
                key={p.key}
                {...getItemProps({ item: p, index: i })}
                className={i === highlightedIndex ? "is-active" : undefined}
              >
                <span className="space-modal__suggestion-key">{p.key}</span>
                {p.name && <span className="space-modal__suggestion-name">{p.name}</span>}
              </li>
            ))}
          </ul>
        </div>

        {loadError && (
          <p className="space-modal__hint">
            Couldn't load project list ({loadError}); type a key manually.
          </p>
        )}

        <div className="space-modal__actions">
          <button className="space-modal__btn space-modal__btn--secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="space-modal__btn" onClick={() => handleConfirm()}>
            Use this space
          </button>
        </div>
      </div>
    </div>
  );
}
