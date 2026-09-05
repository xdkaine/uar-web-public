import { describe, expect, it } from 'vitest';
import { requireReachableIcmpResponse } from './icmp-probe-response';

describe('requireReachableIcmpResponse', () => {
  it('rejects HTTP failures and releases their body', async () => {
    const response = new Response('not json', { status: 503 });
    await expect(requireReachableIcmpResponse(response)).rejects.toThrow(
      'ICMP probe service failed (status 503)',
    );
    expect(response.bodyUsed).toBe(true);
  });

  it('accepts a reachable response and rejects an unreachable target', async () => {
    await expect(
      requireReachableIcmpResponse(Response.json({ reachable: true })),
    ).resolves.toBeUndefined();
    await expect(
      requireReachableIcmpResponse(
        Response.json({ reachable: false, error: 'probe timed out' }),
      ),
    ).rejects.toThrow('probe timed out');
  });

  it('uses a stable error when a successful response has no valid result body', async () => {
    await expect(
      requireReachableIcmpResponse(new Response('not json', { status: 200 })),
    ).rejects.toThrow('ICMP target did not answer');
    await expect(
      requireReachableIcmpResponse(Response.json({ reachable: 'false' })),
    ).rejects.toThrow('ICMP target did not answer');
  });
});
