type MenuAction = 'accept' | 'human' | 'stop' | 'support' | 'plans' | 'payments' | 'status' | 'inbox';
type MenuPurpose = 'notice' | 'support' | 'admin' | 'reply';
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const uuidPattern = new RegExp('^' + uuid + '(?![\\s\\S])');
const choicePattern = new RegExp('^sarinbot\\.menu\\.v1:(accept|human|stop|support|plans|payments|status|inbox):(' + uuid + ')(?![\\s\\S])');
const titles: Record<MenuAction, string> = { accept: 'Aceptar', human: 'Atención humana', stop: 'Salir', support: 'Soporte', plans: 'Planes y suscripción', payments: 'Pagos pendientes', status: 'Estado de SarinBot', inbox: 'Soporte recibido' };
const actions: Record<MenuPurpose, MenuAction[]> = { notice: ['accept', 'human', 'stop'], support: ['support', 'plans', 'human'], admin: ['payments', 'status', 'inbox'], reply: ['human', 'stop'] };

/** Syntax only: constructing or parsing a menu grants no action or identity. */
export function createPlatformMenu(outboxId: string, purpose: MenuPurpose): Array<{ id: string; title: string }> {
  if (typeof outboxId !== 'string' || !uuidPattern.test(outboxId) || !Object.hasOwn(actions, purpose)) throw new Error('Invalid platform menu');
  return actions[purpose].map(action => ({ id: `sarinbot.menu.v1:${action}:${outboxId}`, title: titles[action] }));
}
export function parsePlatformMenuChoice(id: unknown): { outboxId: string; action: MenuAction } | null {
  if (typeof id !== 'string') return null;
  const match = choicePattern.exec(id);
  return match ? { outboxId: match[2], action: match[1] as MenuAction } : null;
}
