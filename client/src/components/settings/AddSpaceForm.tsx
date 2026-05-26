import { useEffect, useMemo, useState } from "react";
import { useCombobox } from "downshift";
import { JiraProjectSummary } from "../../types";
import { fetchJiraProjects } from "../../api";

interface Props {
  onAdd: (spaceKey: string) => Promise<void>;
  disabled?: boolean;
}

const MAX_SUGGESTIONS = 8;

function filterProjects(projects: JiraProjectSummary[], query: string): JiraProjectSummary[] {
  const q = query.trim().toUpperCase();
  if (!q) return projects.slice(0, MAX_SUGGESTIONS);
  const matches = projects.filter(
    (p) => p.key.toUpperCase().includes(q) || p.name.toUpperCase().includes(q),
  );
  matches.sort((a, b) => {
    const aStarts = a.key.toUpperCase().startsWith(q) ? 0 : 1;
    const bStarts = b.key.toUpperCase().startsWith(q) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return a.key.localeCompare(b.key);
  });
  return matches.slice(0, MAX_SUGGESTIONS);
}

export function AddSpaceForm({ onAdd, disabled }: Props) {
  const [inputValue, setInputValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<JiraProjectSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (disabled || projects !== null) return;
    let cancelled = false;
    fetchJiraProjects()
      .then((res) => {
        if (cancelled) return;
        setProjects(res.projects);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load projects");
        setProjects([]);
      });
    return () => { cancelled = true; };
  }, [disabled, projects]);

  const items = useMemo(
    () => filterProjects(projects ?? [], inputValue),
    [projects, inputValue],
  );

  async function submitKey(rawKey: string) {
    const key = rawKey.trim().toUpperCase();
    if (!key) return;
    setBusy(true);
    try {
      await onAdd(key);
      setInputValue("");
    } finally {
      setBusy(false);
    }
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
      if (selectedItem) void submitKey(selectedItem.key);
    },
  });

  const inputProps = getInputProps({
    placeholder: "Project key or name (e.g. CUS)",
    disabled: disabled || busy,
    autoComplete: "off",
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && highlightedIndex < 0) {
        e.preventDefault();
        void submitKey(inputValue);
      }
    },
  });

  return (
    <div className="add-space-form">
      <div className="add-space-form__row">
        <input {...inputProps} />
        <button
          onClick={() => submitKey(inputValue)}
          disabled={disabled || busy || !inputValue.trim()}
        >
          {busy ? "Discovering…" : "+ Add space"}
        </button>
        <ul
          {...getMenuProps()}
          className="add-space-form__suggestions"
          hidden={!isOpen || items.length === 0 || busy}
        >
          {isOpen && !busy && items.map((p, i) => (
            <li
              key={p.key}
              {...getItemProps({ item: p, index: i })}
              className={i === highlightedIndex ? "is-active" : undefined}
            >
              <span className="add-space-form__suggestion-key">{p.key}</span>
              <span className="add-space-form__suggestion-name">{p.name}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="settings-hint">
        The space (project) key is the prefix of a ticket key — e.g. in <code>API-101</code> the space is <code>API</code>.
        {loadError && <> — couldn't load project list ({loadError}); type the key manually.</>}
      </p>
    </div>
  );
}
