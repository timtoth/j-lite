import { useEffect, useState } from "react";

export interface SpaceModalProps {
  knownSpaces: string[];
  detectedSpaces: string[];
  onConfirm: (space: string) => void;
  onCancel: () => void;
}

export function SpaceModal({ knownSpaces, detectedSpaces, onConfirm, onCancel }: SpaceModalProps) {
  const initial =
    detectedSpaces[0] ??
    knownSpaces[0] ??
    "";
  const [selection, setSelection] = useState<string>(initial);
  const [freeText, setFreeText] = useState<string>("");

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleConfirm();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, freeText]);

  const offered = Array.from(new Set([...detectedSpaces, ...knownSpaces]));
  const isMulti = detectedSpaces.length > 1;

  function handleConfirm() {
    const chosen = freeText.trim() || selection.trim();
    if (!chosen) return;
    onConfirm(chosen.toUpperCase());
  }

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

        <div className="space-modal__options">
          {offered.map((s) => (
            <label key={s} className="space-modal__option">
              <input
                type="radio"
                name="space"
                value={s}
                checked={selection === s && !freeText}
                onChange={() => { setSelection(s); setFreeText(""); }}
              />
              {s}
            </label>
          ))}
          <label className="space-modal__option">
            <input
              type="radio"
              name="space"
              checked={!!freeText}
              onChange={() => setFreeText(freeText || " ")}
            />
            <input
              type="text"
              className="space-modal__free-text"
              placeholder="Or type a project key (e.g. PSO)"
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              onFocus={() => setFreeText(freeText || " ")}
            />
          </label>
        </div>

        <div className="space-modal__actions">
          <button className="space-modal__btn space-modal__btn--secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="space-modal__btn" onClick={handleConfirm}>
            Use this space
          </button>
        </div>
      </div>
    </div>
  );
}
