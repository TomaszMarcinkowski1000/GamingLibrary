import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface TagInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  id?: string;
}

/**
 * Controlled, presentational chip editor for a `string[]` field (genre, developer, series).
 *
 * Enter or comma commits the typed token; Backspace on an empty input removes the last chip.
 * Tokens are trimmed, empties ignored, and adds are case-insensitive deduped (the existing
 * casing wins). No fetch, no dialog — it just edits an array and reports up via `onChange`.
 */
export function TagInput({ value, onChange, placeholder, id }: TagInputProps) {
  const [draft, setDraft] = useState("");

  function commit(token: string) {
    const trimmed = token.trim();
    if (!trimmed) {
      return;
    }
    if (value.some((item) => item.toLowerCase() === trimmed.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...value, trimmed]);
    setDraft("");
  }

  function removeAt(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit(draft);
    } else if (event.key === "Backspace" && draft.length === 0 && value.length > 0) {
      event.preventDefault();
      removeAt(value.length - 1);
    }
  }

  return (
    <div
      className={cn(
        "border-input flex flex-wrap items-center gap-1.5 rounded-md border bg-transparent px-2 py-1.5 text-sm shadow-xs",
        "focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]",
      )}
    >
      {value.map((tag, index) => (
        <span
          key={tag}
          className="bg-secondary text-secondary-foreground inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs"
        >
          {tag}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            onClick={() => {
              removeAt(index);
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          commit(draft);
        }}
        placeholder={value.length === 0 ? placeholder : undefined}
        className="placeholder:text-muted-foreground flex-1 bg-transparent outline-none"
      />
    </div>
  );
}
