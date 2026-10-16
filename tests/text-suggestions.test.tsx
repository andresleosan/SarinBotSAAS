import { act, createElement, useState } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import { TextSuggestions } from '@/components/text-suggestions';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('editable field suggestions', () => {
  let renderer: ReactTestRenderer;
  let changes: string[];
  function Harness({ initial = 'Texto propio', limit = 2000 }: { initial?: string; limit?: number }) {
    const [value, setValue] = useState(initial);
    return createElement(TextSuggestions, {
      label: 'Ejemplos de prueba', value, maxLength: limit,
      suggestions: [{ label: 'Primera visita', value: '¿Es tu primera visita?' }],
      onChange: (next: string) => { changes.push(next); setValue(next); },
    });
  }
  async function mount(initial?: string, limit?: number) {
    changes = [];
    await act(async () => { renderer = create(createElement(Harness, { initial, limit })); });
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
});
