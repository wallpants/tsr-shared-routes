// `-` prefix: helper file, never a route (stock convention, not mirrored).
export interface Provider {
  id: string;
  name: string;
  balance: number;
}

const PROVIDERS: Array<Provider> = [
  { id: "acme", name: "Acme Corp", balance: 1200 },
  { id: "globex", name: "Globex", balance: -300 },
  { id: "initech", name: "Initech", balance: 0 },
];

export async function fetchProviders(): Promise<Array<Provider>> {
  return PROVIDERS;
}

export async function fetchProvider(id: string): Promise<Provider> {
  const provider = PROVIDERS.find((p) => p.id === id);
  if (!provider) throw new Error(`Unknown provider: ${id}`);
  return provider;
}
