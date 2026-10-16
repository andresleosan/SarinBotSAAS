import { act, createElement, useState } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import { TextSuggestions } from '@/components/text-suggestions';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('editable field suggestions', () => {
  let renderer: ReactTestRenderer;
  let changes: string[];
  const suggestions = [
    { label: 'Primera visita', value: '¿Es tu primera visita?' },
    { label: 'Profesional', value: '¿Qué profesional prefieres?' },
    { label: 'Servicio', value: '¿Qué servicio deseas?' },
    { label: 'Día', value: '¿Qué día prefieres?' },
  ];
  function Harness({ initial = 'Texto propio', limit = 2000, overflow = false }: { initial?: string; limit?: number; overflow?: boolean }) {
    const [value, setValue] = useState(initial);
    return createElement(TextSuggestions, {
      label: 'Ejemplos de prueba', value, maxLength: limit,
      suggestions: overflow ? suggestions : suggestions.slice(0, 1),
      onChange: (next: string) => { changes.push(next); setValue(next); },
    });
  }
  async function mount(initial?: string, limit?: number, overflow?: boolean) {
    changes = [];
    await act(async () => { renderer = create(createElement(Harness, { initial, limit, overflow })); });
  }
  afterEach(async () => { await act(async () => renderer?.unmount()); });

  it('changes nothing on mount and appends only after a non-submit button is pressed', async () => {
    await mount();
    expect(changes).toEqual([]);
    const button = renderer.root.findByType('button');
    expect(button.props.type).toBe('button');
    await act(async () => button.props.onClick());
    expect(changes).toEqual(['Texto propio\n¿Es tu primera visita?']);
    expect(renderer.root.findByType('button').props.disabled).toBe(true);
    await act(async () => renderer.root.findByType('button').props.onClick());
    expect(changes).toHaveLength(1);
  });

  it('recognizes an existing line despite case and whitespace differences', async () => {
    await mount('Otra pregunta\n  ¿ES   TU PRIMERA VISITA?  ');
    expect(renderer.root.findByType('button').props.disabled).toBe(true);
    await act(async () => renderer.root.findByType('button').props.onClick());
    expect(changes).toEqual([]);
  });

  it('keeps the original text and its existing trailing newline', async () => {
    await mount('Texto propio  \n');
    await act(async () => renderer.root.findByType('button').props.onClick());
    expect(changes).toEqual(['Texto propio  \n¿Es tu primera visita?']);
  });

  it('does not insert an example beyond the field length limit', async () => {
    await mount('Texto propio', 20);
    expect(renderer.root.findByType('button').props.disabled).toBe(true);
    await act(async () => renderer.root.findByType('button').props.onClick());
    expect(changes).toEqual([]);
  });

  it('keeps additional suggestions selectable without duplicating existing lines or accepting unknown values', async () => {
    await mount('Texto propio\n  ¿QUÉ DÍA   PREFIERES? ', undefined, true);
    const choose = (value: string) => renderer.root.findByType('select').props.onChange({ target: { value } });
    expect(renderer.root.findAllByType('button')).toHaveLength(3);
    expect(renderer.root.findByProps({ value: suggestions[3].value }).props.disabled).toBe(true);
    await act(async () => choose(suggestions[3].value));
    await act(async () => choose('Opción desconocida'));
    expect(changes).toEqual([]);
  });

  it('enforces the field length limit for dropdown suggestions too', async () => {
    await mount('Texto propio', 20, true);
    expect(renderer.root.findByProps({ value: suggestions[3].value }).props.disabled).toBe(true);
    await act(async () => renderer.root.findByType('select').props.onChange({ target: { value: suggestions[3].value } }));
    expect(changes).toEqual([]);
  });
});
