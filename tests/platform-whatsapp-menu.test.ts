import { describe, expect, it } from 'vitest';
import { createPlatformMenu, parsePlatformMenuChoice } from '../shared/platform-whatsapp-menu';

const id = '12345678-1234-4234-8234-123456789abc';
describe('pure platform menu syntax', () => {
  it.each([
    ['notice', [['accept', 'Aceptar'], ['human', 'Atención humana'], ['stop', 'Salir']]],
    ['support', [['support', 'Soporte'], ['plans', 'Planes y suscripción'], ['human', 'Atención humana']]],
    ['admin', [['payments', 'Pagos pendientes'], ['status', 'Estado de SarinBot'], ['inbox', 'Soporte recibido']]],
    ['reply', [['human', 'Atención humana'], ['stop', 'Salir']]],
  ] as const)('constructs the exact ordered %s menu', (purpose, entries) => {
    const menu = createPlatformMenu(id, purpose);
    expect(menu).toEqual(entries.map(([action, title]) => ({ id: `sarinbot.menu.v1:${action}:${id}`, title })));
    expect(menu.length).toBeLessThanOrEqual(3);
    for (const [index, item] of menu.entries()) expect(parsePlatformMenuChoice(item.id)).toEqual({ outboxId: id, action: entries[index][0] });
  });
  it.each([null, undefined, 1, {}, 'Aceptar', '1', `sarinbot.menu.v2:accept:${id}`, `foreign:accept:${id}`, `sarinbot.menu.v1:unknown:${id}`, `sarinbot.menu.v1:accept:${id.toUpperCase()}`, `sarinbot.menu.v1:accept:${id}\n`, ` sarinbot.menu.v1:accept:${id}`, `sarinbot.menu.v1:accept:${id}:extra`])('rejects untrusted syntax %j', value => {
    expect(parsePlatformMenuChoice(value)).toBeNull();
  });
  it('rejects invalid constructor inputs and returns independent values', () => {
    expect(() => createPlatformMenu(id + '\n', 'notice')).toThrow();
    expect(() => createPlatformMenu(id, 'unknown' as never)).toThrow();
    const first = createPlatformMenu(id, 'notice'); first[0].title = 'Changed';
    expect(createPlatformMenu(id, 'notice')[0].title).toBe('Aceptar');
  });
});
