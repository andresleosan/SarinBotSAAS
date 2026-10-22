import { workExact, workInteger, workObject, type CostStage } from './platform-whatsapp-work.ts';

export type RationalRate = { numerator: number; denominator: number };
export type SendEvidence = { version: string; currency: 'USD'; timezone: 'UTC'; category: 'service'; destinationScope: 'all_e164'; rate: RationalRate };
export type TariffPolicy = { sendEvidence?: SendEvidence; version: string; audio: RationalRate; generationInput: RationalRate; generationOutput: RationalRate; send: RationalRate; maximumInputTokens: number; maximumOutputTokens: number };
export type WorkPolicy = { generationMapping?: GenerationPolicy; tariff: TariffPolicy; limits: Record<CostStage, number>; enabled: Record<CostStage, boolean> };
const rate = (v: unknown): v is RationalRate => workObject(v) && workExact(v, ['numerator', 'denominator']) && workInteger(v.numerator) && workInteger(v.denominator) && v.denominator > 0;
export type WorkPolicyEnvironment = Partial<Record<'PLATFORM_WHATSAPP_GENERATION_POLICY' | 'PLATFORM_WHATSAPP_TARIFF_POLICY' | 'PLATFORM_WHATSAPP_AUDIO_ENABLED' | 'PLATFORM_WHATSAPP_AI_ENABLED' | 'PLATFORM_WHATSAPP_SEND_ENABLED' | 'PLATFORM_WHATSAPP_AUDIO_DAILY_BUDGET_MICROS' | 'PLATFORM_WHATSAPP_GENERATION_DAILY_BUDGET_MICROS' | 'PLATFORM_WHATSAPP_SEND_DAILY_BUDGET_MICROS', string>>;
export function parsePlatformWorkPolicy(env: WorkPolicyEnvironment): WorkPolicy | null {
  let tariff: unknown;
  try { tariff = JSON.parse(env.PLATFORM_WHATSAPP_TARIFF_POLICY ?? 'null'); } catch { return null; }
  if (!workObject(tariff) || !workExact(tariff, ['version', 'audio', 'generationInput', 'generationOutput', 'send', 'maximumInputTokens', 'maximumOutputTokens', ...Object.hasOwn(tariff, 'sendEvidence') ? ['sendEvidence'] : []]) || typeof tariff.version !== 'string' || !/^[A-Za-z0-9_-]{1,128}(?![\s\S])/.test(tariff.version) || !['audio', 'generationInput', 'generationOutput', 'send'].every(k => rate(tariff[k])) || !workInteger(tariff.maximumInputTokens) || tariff.maximumInputTokens < 1 || !workInteger(tariff.maximumOutputTokens) || tariff.maximumOutputTokens < 1) return null;
  if (Object.hasOwn(tariff, 'sendEvidence') && !validSendEvidence(tariff.sendEvidence, tariff as TariffPolicy)) return null;
  const limit = (name: keyof WorkPolicyEnvironment) => { const v = env[name]; return v && /^(0|[1-9][0-9]*)(?![\s\S])/.test(v) && workInteger(Number(v)) ? Number(v) : 0; };
  return { ...(parseGenerationPolicy(env.PLATFORM_WHATSAPP_GENERATION_POLICY) ? { generationMapping: parseGenerationPolicy(env.PLATFORM_WHATSAPP_GENERATION_POLICY)! } : {}), tariff: tariff as TariffPolicy, limits: { audio: limit('PLATFORM_WHATSAPP_AUDIO_DAILY_BUDGET_MICROS'), generation: limit('PLATFORM_WHATSAPP_GENERATION_DAILY_BUDGET_MICROS'), send: limit('PLATFORM_WHATSAPP_SEND_DAILY_BUDGET_MICROS') }, enabled: { audio: env.PLATFORM_WHATSAPP_AUDIO_ENABLED === 'true', generation: env.PLATFORM_WHATSAPP_AI_ENABLED === 'true', send: env.PLATFORM_WHATSAPP_SEND_ENABLED === 'true' } };
}
/** Stable, explicit ordering is shared across Node and Worker policy hashing. */
export function platformPolicyTuple(p: WorkPolicy): unknown[] {
  const r = (v: RationalRate) => [v.numerator, v.denominator];
  return [p.tariff.version, r(p.tariff.audio), r(p.tariff.generationInput), r(p.tariff.generationOutput), r(p.tariff.send), p.tariff.maximumInputTokens, p.tariff.maximumOutputTokens, ...(['audio', 'generation', 'send'] as const).flatMap(s => [p.limits[s], p.enabled[s]]), ...p.generationMapping ? [generationPolicyTuple(p, p.generationMapping)] : [], ...p.tariff.sendEvidence ? [p.tariff.sendEvidence.version, 'USD', 'UTC', 'service', 'all_e164', r(p.tariff.sendEvidence.rate)] : []];
}
export function platformCost(components: Array<{ units: number; rate: RationalRate }>): number {
  let total = 0n;
  for (const c of components) {
    if (!workInteger(c.units) || !rate(c.rate)) throw new Error('Invalid platform cost');
    const n = BigInt(c.units) * BigInt(c.rate.numerator), d = BigInt(c.rate.denominator);
    total += (n + d - 1n) / d;
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Platform cost overflow');
  return Number(total);
}
export function maximumPlatformCost(policy: WorkPolicy, stage: CostStage): number {
  return platformCost(stage === 'audio' ? [{ units: 120_000, rate: policy.tariff.audio }] : stage === 'send' ? [{ units: 1, rate: policy.tariff.send }] : [{ units: policy.tariff.maximumInputTokens, rate: policy.tariff.generationInput }, { units: policy.tariff.maximumOutputTokens, rate: policy.tariff.generationOutput }]);
}

export type GenerationPolicy = { version: string; responseModels: string[] };
/** No response wire spelling is inferred from the requested alias. */
export function parseGenerationPolicy(raw: string | undefined): GenerationPolicy | null {
  let v: unknown; try { v = JSON.parse(raw ?? 'null'); } catch { return null; }
  if (!workObject(v) || !workExact(v, ['version', 'responseModels']) || typeof v.version !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v.version) || !Array.isArray(v.responseModels) || !v.responseModels.length || v.responseModels.length > 12 || v.responseModels.some(m => typeof m !== 'string' || !/^[A-Za-z0-9_.:-]{1,100}$/.test(m)) || new Set(v.responseModels).size !== v.responseModels.length) return null;
  return v as GenerationPolicy;
}
export function generationPolicyTuple(p: WorkPolicy, g: GenerationPolicy): unknown[] {
  return ['deepseek', 'deepseek-flash', p.tariff.version, g.version, 128000, 'bytes+4096', 4096, 300, 1000, 1200, 1000, [...g.responseModels].sort()];
}
export function quoteGenerationMicros(bytes: number): number {
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 128000) throw new Error('Invalid generation bytes');
  return platformCost([{ units: bytes + 4096, rate: { numerator: 300, denominator: 1000 } }, { units: 4096, rate: { numerator: 1200, denominator: 1000 } }]);
}

export function validSendEvidence(v: unknown, tariff: TariffPolicy): v is SendEvidence {
  return workObject(v) && workExact(v, ['version', 'currency', 'timezone', 'category', 'destinationScope', 'rate']) && v.version === tariff.version && v.currency === 'USD' && v.timezone === 'UTC' && v.category === 'service' && v.destinationScope === 'all_e164' && rate(v.rate) && v.rate.numerator > 0 && v.rate.numerator === tariff.send.numerator && v.rate.denominator === tariff.send.denominator;
}
