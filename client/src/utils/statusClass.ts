export function statusClass(status: string): string {
  if (!status) return "status-default";
  const s = status.toLowerCase().replace(/[\s_-]/g, "");
  if (s === "todo" || s === "open" || s === "new") return "status-todo";
  if (s === "inprogress" || s === "doing") return "status-inprogress";
  if (s === "inreview" || s === "review" || s === "codereview") return "status-inreview";
  if (s === "done" || s === "closed" || s === "resolved" || s === "complete") return "status-done";
  if (s === "blocked") return "status-blocked";
  return "status-default";
}
