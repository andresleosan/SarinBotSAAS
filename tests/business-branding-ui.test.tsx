import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { privateBusinessDraft } from '@/lib/server/businesses';
const state = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/client/api', () => ({ apiFetch: state.api, errorMessage: (error: Error) => error.message }));
import { BusinessLogoField } from '@/components/business-logo-field';
import { BusinessSocialFields } from '@/components/business-social-fields';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const business = { ...privateBusinessDraft({ uid: 'owner' }, Date.now()), slug: 'synthetic-business', name: 'Negocio sintético', logo: { sha256: 'a'.repeat(64) } };
describe('business identity controls', () => {
  let renderer: ReactTestRenderer;
  beforeEach(() => { state.api.mockReset(); vi.stubGlobal('FileReader', class { result = 'data:image/png;base64,c3ludGhldGlj'; onload?: () => void; readAsDataURL() { this.onload?.(); } abort() {} }); });
  afterEach(async () => { await act(async () => renderer?.unmount()); vi.unstubAllGlobals(); });
  it('uploads_removes_and_retries with the observed digest, preserving the existing logo on failure', async () => {
    const onSaved = vi.fn();
    await act(async () => { renderer = create(createElement(BusinessLogoField, { business, onSaved })); });
    await act(async () => renderer.root.findByType('input').props.onChange({ target: { files: [new File(['synthetic'], 'logo.png', { type: 'image/png' })] } }));
    const upload = () => renderer.root.findAllByType('button').find(button => button.children.join('').includes('Guardar logo'))!;
    state.api.mockRejectedValueOnce(new Error('Conexión interrumpida')).mockResolvedValueOnce({ business });
    await act(async () => upload().props.onClick());
    expect(renderer.root.findByType('img').props.src).toContain(business.logo.sha256);
    expect(onSaved).not.toHaveBeenCalled();
    await act(async () => upload().props.onClick());
    expect(JSON.parse(state.api.mock.calls[0][1].body)).toMatchObject({ expectedSha256: business.logo.sha256, logoDataUrl: expect.stringContaining('data:image/png') });
    expect(onSaved).toHaveBeenCalledWith(business);
    state.api.mockResolvedValueOnce({ business: { ...business, logo: undefined } });
    await act(async () => renderer.root.findAllByType('button').find(button => button.children.join('').includes('Eliminar logo'))!.props.onClick());
    expect(JSON.parse(state.api.mock.calls[2][1].body)).toEqual({ expectedSha256: business.logo.sha256, logoDataUrl: null });
  });
  it('ignores an old account upload response', async () => {
    const onSaved = vi.fn();
    await act(async () => { renderer = create(createElement(BusinessLogoField, { business, onSaved })); });
    let resolve!: (value: unknown) => void;
    state.api.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    await act(async () => { renderer.root.findAllByType('button').find(button => button.children.join('').includes('Eliminar logo'))!.props.onClick(); });
    await act(async () => renderer.update(createElement(BusinessLogoField, { business: { ...business, id: 'other', ownerUid: 'other' }, onSaved })));
    await act(async () => resolve({ business }));
    expect(onSaved).not.toHaveBeenCalled();
  });
  it('edits up to three social links locally without calling the server', async () => {
    const onChange = vi.fn();
    await act(async () => { renderer = create(createElement(BusinessSocialFields, { value: [], onChange })); });
    await act(async () => renderer.root.findByType('button').props.onClick());
    expect(onChange).toHaveBeenCalledWith([{ platform: 'instagram', url: '' }]);
    expect(state.api).not.toHaveBeenCalled();
  });
});
