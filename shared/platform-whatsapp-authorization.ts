export type ConsentAnchor = { revision: number; fingerprint: string; receiptId: string };
export type PlatformActor = {
  uid: string;
  linkId: string;
  linkRevision: number;
  account: ConsentAnchor;
  support: ConsentAnchor;
  connectionRevision: number;
  conversationRevision: number;
};
