/** Safe owner DTOs: no internal consent anchors, phone indexes or receipt IDs. */
export interface PlatformWhatsAppLinkStatus {
  available: boolean;
  revokeGeneration: string | null;
  current: null | { linkId: string; revision: number; expiresAt: number; maskedPhone: string };
  pending: null | { challengeId: string; revision: number; expiresAt: number; maskedPhone: string; proof: 'pending' | 'verified' };
}
export interface PlatformWhatsAppLinkBegin { challengeId: string; code: string; expiresAt: number; whatsappUrl?: string }
export interface PlatformWhatsAppLinkConfirmation { linkId: string; revision: number; expiresAt: number }
export interface PlatformWhatsAppLinkRevocation { revoked: true }
