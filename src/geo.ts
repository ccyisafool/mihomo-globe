import * as ipaddr from 'ipaddr.js';
import type {
  EarthLocation,
  GeoDatabaseStatus,
  GeoWorkerRequest,
  GeoWorkerResponse,
} from './globe/types';

export interface PublicOrigin {
  ip: string;
  provider: string;
  latitude: number | null;
  longitude: number | null;
  city: string;
  country: string;
}

export const PUBLIC_ORIGIN_PROVIDERS = ['ipip.net', 'ip.sb', 'ipwho.is', 'ipapi.is'] as const;
export type PublicOriginProvider = (typeof PUBLIC_ORIGIN_PROVIDERS)[number];

export interface GeoStatusSnapshot {
  status: GeoDatabaseStatus;
  received: number;
  total: number;
  error?: string;
}

type StatusListener = (snapshot: GeoStatusSnapshot) => void;

const isValidIP = (value: string) => {
  try {
    return ipaddr.isValid(value);
  } catch {
    return false;
  }
};

const coordinate = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const readJson = async (url: string, signal?: AbortSignal) => {
  const response = await fetch(url, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json() as Promise<unknown>;
};

const normalizeOrigin = (provider: PublicOriginProvider, payload: unknown): PublicOrigin => {
  const data = payload as Record<string, unknown>;

  if (provider === 'ipip.net') {
    const nested = data.data as { ip?: string; location?: string[] } | undefined;
    const ip = nested?.ip ?? '';
    if (data.ret !== 'ok' || !isValidIP(ip)) throw new Error('ipip.net lookup failed');
    const [country = '', , city = ''] = nested?.location ?? [];
    return { ip, provider, latitude: null, longitude: null, city, country };
  }

  if (provider === 'ip.sb') {
    const ip = typeof data.ip === 'string' ? data.ip : '';
    if (!isValidIP(ip)) throw new Error('ip.sb lookup failed');
    return {
      ip,
      provider,
      latitude: coordinate(data.latitude),
      longitude: coordinate(data.longitude),
      city: typeof data.city === 'string' ? data.city : '',
      country: typeof data.country === 'string' ? data.country : '',
    };
  }

  if (provider === 'ipwho.is') {
    const ip = typeof data.ip === 'string' ? data.ip : '';
    if (data.success !== true || !isValidIP(ip)) throw new Error('ipwho.is lookup failed');
    return {
      ip,
      provider,
      latitude: coordinate(data.latitude),
      longitude: coordinate(data.longitude),
      city: typeof data.city === 'string' ? data.city : '',
      country: typeof data.country === 'string' ? data.country : '',
    };
  }

  if (typeof data.error === 'string') throw new Error(`ipapi.is lookup failed: ${data.error}`);
  const ip = typeof data.ip === 'string' ? data.ip : '';
  if (!isValidIP(ip)) throw new Error('ipapi.is lookup failed');
  return {
    ip,
    provider,
    latitude: coordinate(data.lat),
    longitude: coordinate(data.lon),
    city: '',
    country: typeof data.cc === 'string' ? data.cc : '',
  };
};

export const getPublicOrigin = async (
  provider: PublicOriginProvider,
  signal?: AbortSignal,
): Promise<PublicOrigin> => {
  const payload = await readJson(
    `./cgi-bin/mihomo-globe-api?path=origin&provider=${encodeURIComponent(provider)}`,
    signal,
  );
  return normalizeOrigin(provider, payload);
};

export class GeoDatabaseClient {
  private readonly worker = new Worker(new URL('./globe/geoip.worker.ts', import.meta.url), {
    type: 'module',
  });

  private requestID = 0;
  private readonly pending = new Map<
    number,
    (locations: Record<string, EarthLocation | null>) => void
  >();

  constructor(private readonly onStatus: StatusListener) {
    this.worker.addEventListener('message', this.handleMessage);
    this.post({ type: 'init' });
  }

  private post(message: GeoWorkerRequest) {
    this.worker.postMessage(message);
  }

  private handleMessage = ({ data }: MessageEvent<GeoWorkerResponse>) => {
    if (data.type === 'lookup') {
      this.pending.get(data.id)?.(data.locations);
      this.pending.delete(data.id);
      return;
    }

    this.onStatus({
      status: data.status,
      received: data.received ?? 0,
      total: data.total ?? 0,
      error: data.error,
    });
  };

  download() {
    this.post({ type: 'download' });
  }

  cancel() {
    this.post({ type: 'cancel' });
  }

  lookup(ips: string[], locale: string) {
    const id = ++this.requestID;
    return new Promise<Record<string, EarthLocation | null>>((resolve) => {
      this.pending.set(id, resolve);
      this.post({ type: 'lookup', id, ips, locale });
    });
  }

  dispose() {
    this.worker.removeEventListener('message', this.handleMessage);
    this.worker.terminate();
    this.pending.clear();
  }
}
