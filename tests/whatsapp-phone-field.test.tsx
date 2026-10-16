import { act, useState } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WhatsAppPhoneField } from "@/components/whatsapp-phone-field";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("WhatsApp country and number field", () => {
  let renderer: ReactTestRenderer;
  const changed = vi.fn();
  async function mount(initialValue = "") {
    changed.mockClear();
    function Form() {
      const [value, setValue] = useState(initialValue);
      return <WhatsAppPhoneField value={value} onChange={(next) => { changed(next); setValue(next); }} />;
    }
    await act(async () => { renderer = create(<Form />); });
  }
  const country = () => renderer.root.findByType("select");
  const number = () => renderer.root.findByType("input");
  afterEach(async () => { await act(async () => renderer?.unmount()); });

  it("separates an existing phone without rewriting the persisted value on load", async () => {
    await mount("573001234567");
    expect(country().props.value).toBe("CO");
    expect(number().props.value).toBe("3001234567");
    expect(changed).not.toHaveBeenCalled();
  });

  it("keeps the chosen country while empty and composes it with the entered number", async () => {
    await mount();
    await act(async () => country().props.onChange({ target: { value: "ES" } }));
    expect(country().props.value).toBe("ES");
    expect(number().props.value).toBe("");
    await act(async () => number().props.onChange({ target: { value: "612 345 678" } }));
    expect(changed).toHaveBeenLastCalledWith("+34612345678");
  });

  it("recognizes a pasted international number without duplicating the prefix", async () => {
    await mount("+573001234567");
    await act(async () => number().props.onChange({ target: { value: "+34 612 345 678" } }));
    expect(country().props.value).toBe("ES");
    expect(number().props.value).toBe("612345678");
    expect(changed).toHaveBeenLastCalledWith("+34612345678");
    await act(async () => number().props.onChange({ target: { value: "" } }));
    expect(changed).toHaveBeenLastCalledWith("");
    expect(country().props.value).toBe("ES");
  });

  it("keeps unknown international numbers editable without prepending Colombia", async () => {
    await mount("+99912345678");
    expect(country().props.value).toBe("");
    expect(number().props.value).toBe("+99912345678");
    expect(changed).not.toHaveBeenCalled();
    await act(async () => number().props.onChange({ target: { value: "+99912345679" } }));
    expect(changed).toHaveBeenLastCalledWith("+99912345679");
  });

  it("honors an explicit country selection when two countries share +1", async () => {
    await mount("+12025550123");
    await act(async () => country().props.onChange({ target: { value: "CA" } }));
    expect(country().props.value).toBe("CA");
    expect(number().props.value).toBe("2025550123");
    await act(async () => number().props.onChange({ target: { value: "2025550124" } }));
    expect(country().props.value).toBe("CA");
    expect(changed).toHaveBeenLastCalledWith("+12025550124");
  });

  it("keeps an invalid national entry visible under the chosen country", async () => {
    await mount("+573001234567");
    await act(async () => number().props.onChange({ target: { value: "3001234567 ext 2" } }));
    expect(country().props.value).toBe("CO");
    expect(number().props.value).toBe("3001234567ext2");
  });

  it("preserves leading zeroes when editing a previously stored national number", async () => {
    await mount("+57001234567");
    await act(async () => number().props.onChange({ target: { value: "001234568" } }));
    expect(changed).toHaveBeenLastCalledWith("+57001234568");
    expect(country().props.value).toBe("CO");
  });

  it("does not leave two plus signs after choosing a country for an unknown number", async () => {
    await mount("+99912345678");
    await act(async () => country().props.onChange({ target: { value: "CO" } }));
    expect(number().props.value).toBe("99912345678");
    expect(changed).toHaveBeenLastCalledWith("+5799912345678");
  });

  it("loads a later business value without emitting an edit", async () => {
    changed.mockClear();
    await act(async () => { renderer = create(<WhatsAppPhoneField value="" onChange={changed} />); });
    await act(async () => { renderer.update(<WhatsAppPhoneField value="+34612345678" onChange={changed} />); });
    expect(country().props.value).toBe("ES");
    expect(number().props.value).toBe("612345678");
    expect(changed).not.toHaveBeenCalled();
  });
});
