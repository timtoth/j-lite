import { useState } from "react";

interface Props {
  onAdd: (spaceKey: string) => Promise<void>;
  disabled?: boolean;
}

export function AddSpaceForm({ onAdd, disabled }: Props) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const key = value.trim().toUpperCase();
    if (!key) return;
    setBusy(true);
    try {
      await onAdd(key);
      setValue("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="add-space-form">
      <input
        type="text"
        placeholder="Project key (e.g. CUS)"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled || busy}
      />
      <button onClick={submit} disabled={disabled || busy || !value.trim()}>
        {busy ? "Discovering…" : "+ Add space"}
      </button>
    </div>
  );
}
