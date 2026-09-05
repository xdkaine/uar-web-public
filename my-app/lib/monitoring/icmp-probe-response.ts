interface IcmpProbeBody {
  reachable?: boolean;
  error?: string;
}

export async function requireReachableIcmpResponse(response: Response): Promise<void> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`ICMP probe service failed (status ${response.status})`);
  }

  const body = (await response.json().catch(() => ({}))) as IcmpProbeBody;
  if (body.reachable !== true) {
    throw new Error(body.error || 'ICMP target did not answer');
  }
}
