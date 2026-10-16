"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Globe2 } from "lucide-react";
import * as flags from "country-flag-icons/react/3x2";
import {
  PHONE_COUNTRIES,
  composeWhatsAppNumber,
  isInternationalPhoneInput,
  normalizeNationalNumber,
  splitWhatsAppNumber,
  type SplitWhatsAppNumber,
} from "@/lib/client/phone-number";

export function WhatsAppPhoneField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [parts, setParts] = useState(() => splitWhatsAppNumber(value));
  const lastValue = useRef(value);
  useEffect(() => {
    if (lastValue.current === value) return;
    lastValue.current = value;
    setParts(splitWhatsAppNumber(value));
  }, [value]);
  const selected = PHONE_COUNTRIES.find((item) => item.country === parts.country);
  const Flag = parts.country ? flags[parts.country as keyof typeof flags] : null;

  function update(next: SplitWhatsAppNumber) {
    const nextValue = composeWhatsAppNumber(next.country, next.nationalNumber);
    lastValue.current = nextValue;
    setParts(next);
    onChange(nextValue);
  }

  function changeNumber(input: string) {
    const nationalNumber = normalizeNationalNumber(input);
    const editingExistingZeroes = Boolean(parts.country) && parts.nationalNumber.startsWith("00") && nationalNumber.startsWith("00");
    if (isInternationalPhoneInput(input) && !editingExistingZeroes) {
      update(splitWhatsAppNumber(input, parts.country || "CO"));
      return;
    }
    update({ ...parts, nationalNumber });
  }

  return (
    <fieldset className="min-w-0">
      <legend className="text-xs text-sarin-muted">WhatsApp</legend>
      <div className="mt-1.5 flex min-h-11 min-w-0 rounded-[10px] border border-sarin-line bg-sarin-paper">
        <div className="relative shrink-0 rounded-l-[9px] border-r border-sarin-line bg-sarin-canvas transition hover:bg-sarin-soft focus-within:z-10 focus-within:ring-2 focus-within:ring-sarin-blue focus-within:ring-offset-2">
          <div aria-hidden="true" className="pointer-events-none flex h-full min-h-11 items-center gap-2 px-2.5 text-sm text-sarin-ink">
            {Flag ? <Flag className="h-4 w-6 rounded-[2px]" /> : <Globe2 className="h-4 w-6" />}
            <span className="tabular-nums">{parts.callingCode ? `+${parts.callingCode}` : "Otro"}</span>
            <ChevronDown className="h-3.5 w-3.5 text-sarin-muted" />
          </div>
          <select
            aria-label="País del WhatsApp"
            title={selected ? `${selected.name} (+${selected.callingCode})` : "Número internacional"}
            value={parts.country}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            onChange={(event) => {
              const next = PHONE_COUNTRIES.find((item) => item.country === event.target.value);
              if (!next) return;
              update({
                country: next.country,
                callingCode: next.callingCode,
                nationalNumber: parts.nationalNumber.replace(/^\+/, ""),
              });
            }}
          >
            {!parts.country && <option value="">Número internacional</option>}
            {PHONE_COUNTRIES.map((item) => (
              <option key={item.country} value={item.country}>
                {item.name} (+{item.callingCode})
              </option>
            ))}
          </select>
        </div>
        <input
          id={id}
          aria-label="Número de WhatsApp"
          aria-describedby={!parts.country ? `${id}-help` : undefined}
          className="min-h-11 min-w-0 w-full flex-1 rounded-r-[9px] bg-transparent px-3 py-2.5 text-sm text-sarin-ink outline-none transition placeholder:text-sarin-muted focus:z-10 focus:ring-2 focus:ring-sarin-blue focus:ring-offset-2"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={parts.nationalNumber}
          onChange={(event) => changeNumber(event.target.value)}
          required
          pattern={parts.country ? `[0-9]{${8 - parts.callingCode.length},${15 - parts.callingCode.length}}` : "[+]?[1-9][0-9]{7,14}"}
          maxLength={40}
          placeholder={parts.country === "CO" ? "300 123 4567" : "Número de teléfono"}
          title={parts.country ? "Escribe el número sin el código del país." : "Incluye el código del país, por ejemplo +57."}
        />
      </div>
      {!parts.country && <p id={`${id}-help`} className="mt-1.5 text-xs text-sarin-muted">Incluye el código de país o selecciónalo en la lista.</p>}
    </fieldset>
  );
}
