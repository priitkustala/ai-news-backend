// The part of the `web-push` 3.6.7 interface this story uses. A local declaration instead of
// the @types/web-push package (no further dependency; priitkustala/ai-news#50).
declare module 'web-push' {
  export interface VapidKeys {
    publicKey: string;
    privateKey: string;
  }
  export interface PushSubscription {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }
  export interface RequestOptions {
    vapidDetails: { subject: string; publicKey: string; privateKey: string };
    TTL: number;
  }
  export interface RequestDetails {
    method: string;
    headers: Record<string, string>;
    body: Buffer | null;
    endpoint: string;
  }
  export function generateVAPIDKeys(): VapidKeys;
  export function generateRequestDetails(
    subscription: PushSubscription,
    payload: string | Buffer,
    options: RequestOptions,
  ): RequestDetails;
  const webpush: {
    generateVAPIDKeys: typeof generateVAPIDKeys;
    generateRequestDetails: typeof generateRequestDetails;
  };
  export default webpush;
}
