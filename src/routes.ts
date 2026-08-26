import * as ipaddr from 'ipaddr.js';
import type { EarthHostTraffic, EarthLocation, EarthLocationHint, EarthRoute } from './globe/types';
import type { LiveConnection } from './mihomo';

type LocatedCoordinates = { latitude: number; longitude: number };

const normalizeIP = (value: string) => {
  try {
    return ipaddr.parse(value).toNormalizedString();
  } catch {
    return null;
  }
};

const coordinateKey = ({ latitude, longitude }: EarthLocation) =>
  `${latitude.toFixed(4)},${longitude.toFixed(4)}`;

const mergeTopHosts = (...groups: EarthHostTraffic[][]) =>
  groups
    .flat()
    .sort((left, right) => right.downloaded - left.downloaded)
    .slice(0, 5);

const hasCoordinates = (
  location: Pick<EarthLocationHint, 'latitude' | 'longitude'> | EarthLocation | null,
): location is (EarthLocationHint | EarthLocation) & LocatedCoordinates =>
  location !== null &&
  location.latitude !== null &&
  location.longitude !== null &&
  Number.isFinite(location.latitude) &&
  Number.isFinite(location.longitude) &&
  location.latitude >= -90 &&
  location.latitude <= 90 &&
  location.longitude >= -180 &&
  location.longitude <= 180;

const resolveOrigin = (
  ip: string,
  local: EarthLocation | null | undefined,
  preferred: EarthLocationHint | null | undefined,
  locale: string,
) => {
  const coordinates = preferred && hasCoordinates(preferred)
    ? preferred
    : local && hasCoordinates(local)
      ? local
      : null;

  if (!coordinates) return null;

  const allowHanNames = locale.toLowerCase().startsWith('zh');
  const languageSafeFallback = (value: string | undefined) => {
    const label = value?.trim() ?? '';
    return allowHanNames || !/\p{Script=Han}/u.test(label) ? label : '';
  };

  return {
    ip,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    // DB-IP is queried with the browser locale, so its names are authoritative.
    // Provider text is only a fallback and must not leak Han labels into an
    // English (or other non-Chinese) interface.
    city: local?.city || languageSafeFallback(preferred?.city),
    country: local?.country || languageSafeFallback(preferred?.country),
  } satisfies EarthLocation;
};

export const buildEarthRoutes = async (
  connections: readonly LiveConnection[],
  originIP: string,
  originHint: EarthLocationHint | null,
  lookup: (ips: string[], locale: string) => Promise<Record<string, EarthLocation | null>>,
) => {
  const normalizedOrigin = normalizeIP(originIP);
  if (!normalizedOrigin) return { routes: [] as EarthRoute[], origin: null };

  const candidates = connections
    .map((connection) => {
      const destinationIP = normalizeIP(connection.metadata.destinationIP ?? '');
      if (!destinationIP) return null;
      return {
        destinationIP,
        upload: connection.uploadSpeed,
        download: connection.downloadSpeed,
        host: (connection.metadata.host ?? '').trim().replace(/\.$/, '') || destinationIP,
        downloaded: connection.download,
      };
    })
    .filter((candidate) => candidate !== null);

  const ips = [...new Set([normalizedOrigin, ...candidates.map(({ destinationIP }) => destinationIP)])];
  const locale = navigator.language || 'en';
  const locations = await lookup(ips, locale);
  const origin = resolveOrigin(normalizedOrigin, locations[normalizedOrigin], originHint, locale);
  if (!origin) return { routes: [] as EarthRoute[], origin: null };

  const aggregated = new Map<string, EarthRoute>();

  for (const candidate of candidates) {
    const destination = locations[candidate.destinationIP];
    if (!destination) continue;
    const path: EarthRoute['path'] = [
      { ...origin, role: 'origin' },
      { ...destination, role: 'destination' },
    ];
    const key = path.map((point) => `${point.role}:${coordinateKey(point)}`).join('>');
    const existing = aggregated.get(key);
    const hostTraffic = [{ host: candidate.host, downloaded: candidate.downloaded }];

    if (existing) {
      existing.connections += 1;
      existing.upload += candidate.upload;
      existing.download += candidate.download;
      existing.topHosts = mergeTopHosts(existing.topHosts, hostTraffic);
    } else {
      aggregated.set(key, {
        key,
        path,
        connections: 1,
        upload: candidate.upload,
        download: candidate.download,
        topHosts: hostTraffic,
      });
    }
  }

  return { routes: [...aggregated.values()], origin };
};
