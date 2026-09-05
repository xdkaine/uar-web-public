/**
 * Minimal surface of oidc-provider used by this service. The upstream package
 * ships its own types behind an exports map that Node16 resolution in this
 * standalone build does not pick up; this ambient declaration pins the API we
 * rely on. Intentionally NO top-level imports/exports so the file stays a
 * global script declaration.
 */
declare module 'oidc-provider' {
  export interface AdapterPayload {
    [key: string]: unknown;
    userCode?: string;
    grantId?: string;
    uid?: string;
    consumed?: number;
  }

  export interface Adapter {
    upsert(id: string, payload: AdapterPayload, expiresIn: number): Promise<unknown>;
    find(id: string): Promise<AdapterPayload | undefined>;
    findByUid(uid: string): Promise<AdapterPayload | undefined>;
    findByUserCode(userCode: string): Promise<AdapterPayload | undefined>;
    destroy(id: string): Promise<unknown>;
    revokeByGrantId(grantId: string): Promise<unknown>;
    consume(id: string): Promise<unknown>;
  }

  export interface InteractionDetails {
    uid: string;
    prompt: { name: string; reasons?: string[] };
    params: Record<string, string>;
    returnTo: string;
    session?: { accountId?: string };
  }

  export class Grant {
    constructor(options?: { accountId?: string; clientId?: string });
    addOIDCScope(scope: string): void;
    save(): Promise<string>;
  }

  export const interactionPolicy: {
    Check: {
      new(
        reason: string,
        description: string,
        check: (ctx: unknown) => boolean | Promise<boolean>
      ): unknown;
      REQUEST_PROMPT: boolean;
      NO_NEED_TO_PROMPT: boolean;
    };
    base(): Array<unknown> & {
      get(name: string): {
        checks: Array<unknown> & {
          add(check: unknown, index?: number): void;
        };
      } | undefined;
    };
  };

  export default class Provider {
    constructor(issuer: string, configuration?: Record<string, unknown>);
    /** Instance setter (no constructor option upstream): koa app.proxy. */
    proxy: boolean;
    /** Koa application EventEmitter surface. */
    on(event: string, listener: (...args: unknown[]) => void): unknown;
    Grant: typeof Grant;
    /** Factory: returns the node request handler (upstream v8 API). */
    callback(): (req: unknown, res: unknown) => Promise<void>;
    interactionDetails(req: unknown, res: unknown): Promise<InteractionDetails>;
    interaction(
      req: unknown,
      res: unknown
    ): Promise<{ uid: string; returnTo: string }>;
    interactionFinished(
      req: unknown,
      res: unknown,
      result: Record<string, unknown>,
      options?: { mergeWithLastSubmission?: boolean }
    ): Promise<void>;
  }
}
