/**
 * Who provides the hosted service, for the legal pages and the DPA record. The values come from the environment
 * (LEGAL_NAME, LEGAL_ADDRESS, LEGAL_COMPANY_ID, LEGAL_EMAIL) so the company details live next to the Stripe keys,
 * not in the code. Until every value is set and LEGAL_FINAL=true, the documents show a draft banner: the texts
 * wait for a lawyer's review (ADR 0015).
 */
export interface Provider {
  name: string;
  address: string;
  companyId: string;
  email: string;
  /** True until the lawyer-reviewed texts and the company details are in place. */
  draft: boolean;
  /** Every company detail is set (the draft may still wait for LEGAL_FINAL). */
  complete: boolean;
}

export function provider(source: Record<string, string | undefined> = process.env): Provider {
  const name = source.LEGAL_NAME?.trim();
  const address = source.LEGAL_ADDRESS?.trim();
  const companyId = source.LEGAL_COMPANY_ID?.trim();
  const email = source.LEGAL_EMAIL?.trim();
  return {
    name: name || '[company name]',
    address: address || '[registered address]',
    companyId: companyId || '[company registration and VAT number]',
    email: email || '[privacy contact email]',
    draft: !(name && address && companyId && email && source.LEGAL_FINAL === 'true'),
    complete: Boolean(name && address && companyId && email),
  };
}

/** Where the "talk to us" links on the public pages go: SALES_EMAIL, else the legal contact, else none. */
export function contactEmail(source: Record<string, string | undefined> = process.env): string | undefined {
  return source.SALES_EMAIL?.trim() || source.LEGAL_EMAIL?.trim() || undefined;
}

/** The provider's details as a DPA acceptance keeps them (dpa_acceptances.provider). */
export function providerSnapshot(p: Provider): { name: string; address: string; companyId: string; email: string } {
  return { name: p.name, address: p.address, companyId: p.companyId, email: p.email };
}

/**
 * The provider an acceptance was made with, for its PDF copy; acceptances from before the snapshot existed fall back
 * to today's values.
 */
export function acceptedProvider(snapshot: unknown, draft: boolean, today: Provider): Provider {
  const s = snapshot as Partial<Record<'name' | 'address' | 'companyId' | 'email', unknown>> | null;
  const str = (v: unknown, fallback: string) => (typeof v === 'string' && v ? v : fallback);
  if (!s || typeof s !== 'object') return { ...today, draft: draft || today.draft };
  const p = { name: str(s.name, today.name), address: str(s.address, today.address), companyId: str(s.companyId, today.companyId), email: str(s.email, today.email) };
  return { ...p, draft, complete: !/^\[.*\]$/.test(p.name) && !/^\[.*\]$/.test(p.address) && !/^\[.*\]$/.test(p.companyId) && !/^\[.*\]$/.test(p.email) };
}
