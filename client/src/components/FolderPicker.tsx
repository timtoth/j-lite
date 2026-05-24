import { useState } from "react";
import { browseFolder } from "../api";

interface Props {
  value: string;
  onChange: (path: string) => void;
}

export function FolderPicker({ value, onChange }: Props) {
  const [browsing, setBrowsing] = useState(false);

  async function handleBrowse() {
    setBrowsing(true);
    try {
      const folder = await browseFolder();
      if (folder) onChange(folder);
    } catch {
      // user cancelled or error
    } finally {
      setBrowsing(false);
    }
  }

  return (
    <div className="folder-select">
      <label htmlFor="folderPath">Project</label>
      <input
        type="text"
        id="folderPath"
        placeholder="C:\path\to\project"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        className="browse-btn"
        onClick={handleBrowse}
        disabled={browsing}
      >
        {browsing ? "..." : "Browse"}
      </button>
    </div>
  );
}
