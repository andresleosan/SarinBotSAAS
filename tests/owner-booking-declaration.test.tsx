import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OwnerBookingDeclaration } from '@/components/owner-booking-declaration';
import { BOOKING_DECLARATION_TEXT, BOOKING_DECLARATION_TEXT_VERSION } from '@/lib/booking-declaration';
import { apiFetch } from '@/lib/client/api';
import type { OwnerBookingDeclarationView } from '@/hooks/use-owner-booking-declaration';

vi.mock('@/lib/client/api', () => ({
  apiFetch: vi.fn(),
  errorMessage: (error: unknown) => error instanceof Error ? error.message : 'Error',
}));

vi.mock('@/components/app-shell', () => ({
  Notice: ({ children, error }: { children: any; error?: boolean }) => createElement('div', { 'data-notice': error ? 'error' : 'info' }, children),
  buttonClass: 'button-class',
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const businessId = 'demo-business';
const ownerUid = 'demo-owner';

const baseView: OwnerBookingDeclarationView = {
  capability: {
    configured: false,
    revision: 0,
    dataMode: 'general',
    representedMinorsEnabled: false,
    admission: 'classification_required',
    canStartBooking: false,
    canUseInference: false,
  },
  origin: null,
  declaration: null,
};

describe('OwnerBookingDeclaration', () => {
  let renderer: ReactTestRenderer;

  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  afterEach(async () => {
    await act(async () => { renderer?.unmount(); });
  });

  const content = () => JSON.stringify(renderer.toJSON());

  it('renders classification_required with unselected checkbox and full declaration text', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(baseView);

    await act(async () => {
      renderer = create(createElement(OwnerBookingDeclaration, { businessId, uid: ownerUid, authEpoch: 1 }));
    });

    expect(content()).toContain('Requiere clasificación');
    expect(content()).toContain(BOOKING_DECLARATION_TEXT);

    const checkbox = renderer.root.findByProps({ 'aria-label': 'Acepto la declaración de clasificación' });
    expect(checkbox.props.checked).toBe(false);

    const declareBtn = renderer.root.findAllByType('button').find(b => b.children.includes('Declarar servicios generales para adultos'));
    expect(declareBtn).toBeDefined();
    expect(declareBtn!.props.disabled).toBe(true);

    // Check the box
    await act(async () => {
      checkbox.props.onChange({ target: { checked: true } });
    });
    expect(declareBtn!.props.disabled).toBe(false);
  });

  it('submits declaration with versioned text and updates view on success without double-click duplicate', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(baseView);

    await act(async () => {
      renderer = create(createElement(OwnerBookingDeclaration, { businessId, uid: ownerUid, authEpoch: 1 }));
    });

    const checkbox = renderer.root.findByProps({ 'aria-label': 'Acepto la declaración de clasificación' });
    await act(async () => {
      checkbox.props.onChange({ target: { checked: true } });
    });

    const activeView: OwnerBookingDeclarationView = {
      capability: {
        configured: true,
        revision: 1,
        dataMode: 'general',
        representedMinorsEnabled: false,
        admission: 'active',
        canStartBooking: true,
        canUseInference: true,
      },
      origin: 'owner',
      declaration: {
        textVersion: BOOKING_DECLARATION_TEXT_VERSION,
        receiptId: 'receipt-12345678',
      },
      outcome: 'applied',
    };

    let resolvePatch!: (v: unknown) => void;
    vi.mocked(apiFetch).mockImplementationOnce(() => new Promise(res => { resolvePatch = res; }));

    const declareBtn = renderer.root.findAllByType('button').find(b => b.children.includes('Declarar servicios generales para adultos'))!;
    
    // First click
    let clickPromise: Promise<void>;
    await act(async () => {
      clickPromise = declareBtn.props.onClick();
    });

    // Rapid second click while pending should not trigger another PATCH
    await act(async () => {
      await declareBtn.props.onClick();
    });

    const patchCalls = vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method === 'PATCH');
    expect(patchCalls).toHaveLength(1);
    const sentBody = JSON.parse(patchCalls[0][1]?.body as string);
    expect(sentBody).toMatchObject({
      action: 'declare',
      expectedRevision: 0,
      textVersion: BOOKING_DECLARATION_TEXT_VERSION,
    });
    expect(typeof sentBody.requestId).toBe('string');

    // Resolve PATCH
    await act(async () => {
      resolvePatch(activeView);
      await clickPromise;
    });

    expect(content()).toContain('Clasificación activa');
    expect(content()).toContain('receipt-12345678');
    expect(content()).toContain('Retirar declaración');
  });

  it('allows owner to withdraw declaration with confirmation and shows withdrawn state', async () => {
    const activeView: OwnerBookingDeclarationView = {
      capability: {
        configured: true,
        revision: 1,
        dataMode: 'general',
        representedMinorsEnabled: false,
        admission: 'active',
        canStartBooking: true,
        canUseInference: true,
      },
      origin: 'owner',
      declaration: {
        textVersion: BOOKING_DECLARATION_TEXT_VERSION,
        receiptId: 'receipt-12345678',
      },
    };
    vi.mocked(apiFetch).mockResolvedValueOnce(activeView);

    await act(async () => {
      renderer = create(createElement(OwnerBookingDeclaration, { businessId, uid: ownerUid, authEpoch: 1 }));
    });

    expect(content()).toContain('receipt-12345678');
    const withdrawBtn = renderer.root.findAllByType('button').find(b => b.children.includes('Retirar declaración de reservas'))!;
    await act(async () => {
      withdrawBtn.props.onClick();
    });

    expect(content()).toContain('¿Retirar la declaración?');

    const withdrawnView: OwnerBookingDeclarationView = {
      capability: {
        configured: true,
        revision: 2,
        dataMode: 'general',
        representedMinorsEnabled: false,
        admission: 'withdrawn',
        canStartBooking: false,
        canUseInference: false,
      },
      origin: 'owner',
      declaration: null,
      outcome: 'applied',
    };
    vi.mocked(apiFetch).mockResolvedValueOnce(withdrawnView);

    const confirmBtn = renderer.root.findAllByType('button').find(b => b.children.includes('Confirmar retirada'))!;
    await act(async () => {
      await confirmBtn.props.onClick();
    });

    expect(content()).toContain('Declaración retirada');
    expect(content()).toContain('Declarar de nuevo');
  });

  it('displays administrative review and does not allow owner autodeclaration', async () => {
    const adminReviewView: OwnerBookingDeclarationView = {
      capability: {
        configured: true,
        revision: 2,
        dataMode: 'general',
        representedMinorsEnabled: false,
        admission: 'administrative_review',
        canStartBooking: false,
        canUseInference: false,
      },
      origin: 'admin',
      declaration: null,
    };
    vi.mocked(apiFetch).mockResolvedValueOnce(adminReviewView);

    await act(async () => {
      renderer = create(createElement(OwnerBookingDeclaration, { businessId, uid: ownerUid, authEpoch: 1 }));
    });

    expect(content()).toContain('Requiere revisión administrativa');
    expect(renderer.root.findAllByProps({ 'aria-label': 'Acepto la declaración de clasificación' })).toHaveLength(0);
  });

  it('displays transitioning state and allows refreshing outcome', async () => {
    const transitioningView: OwnerBookingDeclarationView = {
      capability: {
        configured: true,
        revision: 2,
        dataMode: 'general',
        representedMinorsEnabled: false,
        admission: 'transitioning',
        canStartBooking: false,
        canUseInference: false,
      },
      origin: 'owner',
      declaration: null,
      outcome: 'pending',
    };
    vi.mocked(apiFetch).mockResolvedValueOnce(transitioningView);

    await act(async () => {
      renderer = create(createElement(OwnerBookingDeclaration, { businessId, uid: ownerUid, authEpoch: 1 }));
    });

    expect(content()).toContain('En transición');
    expect(content()).toContain('pendiente de resolución');

    const refreshBtn = renderer.root.findAllByType('button').find(b => b.children.includes('Consultar resultado'))!;
    expect(refreshBtn).toBeDefined();
  });

  it('masks private receipt and does not leak state when authEpoch or UID changes', async () => {
    const activeView: OwnerBookingDeclarationView = {
      capability: {
        configured: true,
        revision: 1,
        dataMode: 'general',
        representedMinorsEnabled: false,
        admission: 'active',
        canStartBooking: true,
        canUseInference: true,
      },
      origin: 'owner',
      declaration: {
        textVersion: BOOKING_DECLARATION_TEXT_VERSION,
        receiptId: 'secret-receipt-888',
      },
    };
    vi.mocked(apiFetch).mockResolvedValueOnce(activeView);

    await act(async () => {
      renderer = create(createElement(OwnerBookingDeclaration, { businessId, uid: ownerUid, authEpoch: 1 }));
    });
    expect(content()).toContain('secret-receipt-888');

    // Re-render with new epoch
    let resolveStale!: (v: unknown) => void;
    vi.mocked(apiFetch).mockImplementationOnce(() => new Promise(res => { resolveStale = res; }));

    await act(async () => {
      renderer.update(createElement(OwnerBookingDeclaration, { businessId, uid: ownerUid, authEpoch: 2 }));
    });

    // Old receipt must be gone immediately
    expect(content()).not.toContain('secret-receipt-888');
  });
});
