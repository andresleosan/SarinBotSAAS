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
  const choices = suggestions.map(suggestion => {
    const added = existing.has(normalizedLine(suggestion.value));
    const next = value + (value && !value.endsWith("\n") ? "\n" : "") + suggestion.value;
    return { ...suggestion, added, next, disabled: added || next.length > maxLength };
  });
  const remaining = choices.slice(3);
  const controlClass = "min-h-11 rounded-[10px] border border-sarin-line px-3 py-2 text-left text-xs text-sarin-blue transition hover:border-sarin-blue hover:bg-sarin-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sarin-blue disabled:cursor-default disabled:text-sarin-muted disabled:opacity-60";
  return (
    <div role="group" aria-label={label} className="space-y-1">
      <p className="text-xs leading-5 text-sarin-muted">Ejemplos editables: añade solo los que necesites.</p>
      <div className="flex flex-wrap gap-x-2 gap-y-1">
        {choices.slice(0, 3).map(suggestion => {
          return (
            <button
              key={suggestion.value}
              type="button"
              aria-label={`Añadir ejemplo: ${suggestion.label}`}
              disabled={suggestion.disabled}
              onClick={() => { if (!suggestion.disabled) onChange(suggestion.next); }}
              className={controlClass}
            >
              {suggestion.label}{suggestion.added ? " · Añadido" : ""}
            </button>
          );
        })}
        {remaining.length > 0 && (
          <select
            aria-label={`Más sugerencias: ${label}`}
            value=""
            onChange={event => {
              const selected = remaining.find(suggestion => suggestion.value === event.target.value);
              if (selected && !selected.disabled) onChange(selected.next);
            }}
            className={controlClass + " w-40 max-w-full bg-sarin-paper"}
          >
            <option value="" disabled>Más sugerencias</option>
            {remaining.map(suggestion => (
              <option key={suggestion.value} value={suggestion.value} disabled={suggestion.disabled}>
                {suggestion.label}{suggestion.added ? " · Añadido" : ""}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
