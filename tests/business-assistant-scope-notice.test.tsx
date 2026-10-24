import { act, createElement } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BusinessAssistantScopeNotice } from '@/components/business-assistant-scope-notice';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const text = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(text).join('');

describe('business assistant scope notice', () => {
  let renderer: ReactTestRenderer;
  const mount = async (props: Partial<Parameters<typeof BusinessAssistantScopeNotice>[0]> = {}) => {
    await act(async () => { renderer = create(createElement(BusinessAssistantScopeNotice, { configured: true, dataMode: 'general', representedMinorsEnabled: false, ...props })); });
    return renderer.root;
  };
  afterEach(async () => { await act(async () => renderer?.unmount()); vi.unstubAllGlobals(); });

  it('noticeStartsCollapsedAndNamesSources', async () => {
    const root = await mount();
    expect(text(root.findByType('summary'))).toBe('Información y alcance de Sarin');
    expect(root.findByType('details').props.open).toBeUndefined();
    expect(root.findAllByType('dt').map(text)).toEqual(['Catálogo', 'Datos del negocio', 'Horarios', 'Confirmación']);
    expect(root.findAllByType('dd').map(text)).toEqual([
      'Servicios, precios, duración y descripción.',
      'Ubicación y contacto.',
      'Horario publicado y consulta de disponibilidad.',
      'Propuesta revisable y botón Confirmar cita.',
    ]);
  });

  it('noticeDoesNotActivateSendOrSave', async () => {
    const network = vi.fn(() => { throw new Error('Unexpected network request'); });
    vi.stubGlobal('fetch', network);
    const root = await mount();
    expect(root.findAll(node => typeof node.type === 'string' && ['form', 'input', 'textarea', 'button', 'select'].includes(node.type))).toHaveLength(0);
    expect(root.findByType('summary').props.onClick).toBeUndefined();
    expect(root.findByType('details').props.onToggle).toBeUndefined();
    expect(network).not.toHaveBeenCalled();
  });

  it('noticeExplainsSavedPublicConfiguration', async () => {
    const root = await mount({ configured: false });
    expect(text(root)).toContain('Sarin utiliza la configuración guardada de tu negocio para responder sobre servicios, precios, horarios, contacto y modalidad de atención. Los cambios que todavía estás editando no se utilizan hasta guardar.');
    expect(text(root)).toContain('La cita solo queda registrada después de revisar la propuesta y pulsar Confirmar cita.');
    expect(text(root)).toContain('Al guardar la configuración se actualiza tu página de reservas.');
    await act(async () => renderer.update(createElement(BusinessAssistantScopeNotice, { configured: true, dataMode: 'general', representedMinorsEnabled: false })));
    expect(text(root)).not.toContain('Al guardar la configuración se actualiza tu página de reservas.');
    expect(text(root)).not.toMatch(/Guardar borrador|Publicar/);
  });

  it('healthNoticeDoesNotPromiseAiReception', async () => {
    const root = await mount({ dataMode: 'health' });
    expect(text(root)).toContain('Este negocio utiliza reservas mediante formulario, sin IA. La ubicación y el contacto publicados siguen disponibles en su página de reservas.');
    expect(text(root)).not.toContain('Sarin utiliza la configuración guardada');
    expect(text(root)).not.toContain('Confirmar cita');
    expect(root.findAllByType('dl')).toHaveLength(0);
    expect(root.findAllByType('button')).toHaveLength(0);
  });

  it('minorGuidanceKeepsStructuredRoute', async () => {
    for (const dataMode of ['general', 'health'] as const) {
      await mount({ dataMode, representedMinorsEnabled: true });
      expect(text(renderer.root)).toContain('Las reservas para menores usan el formulario y la representación autorizada; no se gestionan mediante este chat general.');
      await act(async () => renderer.unmount());
    }
    await mount();
    expect(text(renderer.root)).not.toContain('Las reservas para menores');
  });

  it('textDoesNotClaimCustomRulesGrantActions', async () => {
    const root = await mount();
    expect(text(root)).toContain('El tono y las indicaciones no crean precios, servicios ni acciones nuevas.');
  });
});
