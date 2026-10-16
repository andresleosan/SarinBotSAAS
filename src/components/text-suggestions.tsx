"use client";

export interface TextSuggestionsProps {
  label: string;
  value: string;
  maxLength: number;
  suggestions: readonly { label: string; value: string }[];
  onChange: (value: string) => void;
}

const normalizedLine = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("es");

export function TextSuggestions({ label, value, maxLength, suggestions, onChange }: TextSuggestionsProps) {
  const existing = new Set(value.split(/\r?\n/).map(normalizedLine));
  return (
    <div role="group" aria-label={label} className="space-y-1">
      <p className="text-xs leading-5 text-sarin-muted">Ejemplos editables: añade solo los que necesites.</p>
      <div className="flex flex-wrap gap-x-2 gap-y-1">
        {suggestions.map(suggestion => {
          const added = existing.has(normalizedLine(suggestion.value));
          const next = value + (value && !value.endsWith("\n") ? "\n" : "") + suggestion.value;
          const disabled = added || next.length > maxLength;
          return (
            <button
              key={suggestion.value}
              type="button"
              aria-label={`Añadir ejemplo: ${suggestion.label}`}
              disabled={disabled}
              onClick={() => { if (!disabled) onChange(next); }}
              className="min-h-11 rounded-[10px] border border-sarin-line px-3 py-2 text-left text-xs text-sarin-blue transition hover:border-sarin-blue hover:bg-sarin-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sarin-blue disabled:cursor-default disabled:text-sarin-muted disabled:opacity-60"
            >
              {suggestion.label}{added ? " · Añadido" : ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}
