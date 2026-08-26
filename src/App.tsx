import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GeoDatabaseClient,
  getPublicOrigin,
  PUBLIC_ORIGIN_PROVIDERS,
  type GeoStatusSnapshot,
  type PublicOrigin,
  type PublicOriginProvider,
} from './geo';
import type { EarthRenderer } from './globe/earthRenderer';
import type { EarthVisualMode } from './globe/rendererTypes';
import {
  DBIP_COMPRESSED_BYTES,
  type EarthEndpointInfo,
  type EarthLocation,
  type EarthRoute,
} from './globe/types';
import { MihomoFeed, type LiveConnection, type MihomoFeedStatus } from './mihomo';
import { buildEarthRoutes } from './routes';
import { WorldMap2D } from './WorldMap2D';

type ViewDimension = '3d' | '2d';
type RememberedRoute = { route: EarthRoute; lastSeen: number };

const ROUTE_LINGER_MS = 8_000;

interface SelectOption {
  value: string;
  label: string;
}

interface SelectMenuProps {
  ariaLabel: string;
  className?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}

function SelectMenu({ ariaLabel, className = '', value, options, onChange }: SelectMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value)?.label ?? value;

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <div className={`select-menu ${className}`} ref={root}>
      <button
        type="button"
        className="select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{selected}</span>
        <span className={`select-chevron ${open ? 'is-open' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="select-popover" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <button
              type="button"
              className={option.value === value ? 'selected' : ''}
              role="option"
              aria-selected={option.value === value}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <span aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const demoOrigin: EarthLocation = {
  ip: '203.0.113.10',
  latitude: 1.3521,
  longitude: 103.8198,
  city: 'Singapore',
  country: 'Singapore',
};

const destinations: EarthLocation[] = [
  { ip: '198.51.100.1', latitude: 39.9042, longitude: 116.4074, city: 'Beijing', country: 'China' },
  { ip: '198.51.100.2', latitude: 30.2741, longitude: 120.1551, city: 'Hangzhou', country: 'China' },
  { ip: '198.51.100.3', latitude: 23.1291, longitude: 113.2644, city: 'Guangzhou', country: 'China' },
  { ip: '198.51.100.4', latitude: 35.6762, longitude: 139.6503, city: 'Tokyo', country: 'Japan' },
  { ip: '198.51.100.5', latitude: 50.1109, longitude: 8.6821, city: 'Frankfurt', country: 'Germany' },
  { ip: '198.51.100.6', latitude: 37.7749, longitude: -122.4194, city: 'San Francisco', country: 'United States' },
];

const demoRoutes: EarthRoute[] = destinations.map((destination, index) => ({
  key: `demo-${index}`,
  path: [
    { ...demoOrigin, role: 'origin' },
    { ...destination, role: 'destination' },
  ],
  connections: 1 + (index % 3),
  upload: index % 2 ? 0 : 42_000 + index * 9_000,
  download: 96_000 + index * 37_000,
  topHosts: [
    {
      host: ['cloudflare.com', 'github.com', 'openai.com', 'apple.com'][index % 4],
      downloaded: 1_200_000 + index * 720_000,
    },
  ],
}));

const initialGeoStatus: GeoStatusSnapshot = {
  status: 'checking',
  received: 0,
  total: DBIP_COMPRESSED_BYTES,
};

const maskIP = (ip: string) => {
  const octets = ip.split('.');
  return octets.length === 4 ? `${octets[0]}.${octets[1]}.*.*` : ip;
};

const formatBytes = (value: number) => {
  if (value < 1_000) return `${value} B`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)} KB`;
  return `${(value / 1_000_000).toFixed(1)} MB`;
};

const geoErrorMessage: Record<string, string> = {
  space: 'This browser does not have enough free storage for the city database.',
  network: 'The city database could not be downloaded.',
  decompress: 'The city database could not be unpacked in this browser.',
  invalid: 'The downloaded city database was invalid.',
  storage: 'The city database could not be saved in browser storage.',
  unsupported: 'This browser cannot unpack the city database.',
  unknown: 'City mapping could not be started.',
};

const providerOptions = PUBLIC_ORIGIN_PROVIDERS.map((provider) => ({
  value: provider,
  label: provider,
}));

const visualModeOptions: SelectOption[] = [
  { value: 'space', label: 'Space' },
  { value: 'flat', label: 'Flat' },
];

const storedChoice = <T extends string>(key: string, choices: readonly T[], fallback: T): T => {
  const stored = window.localStorage.getItem(key) as T | null;
  return stored && choices.includes(stored) ? stored : fallback;
};

export function App() {
  const globeContainer = useRef<HTMLDivElement>(null);
  const renderer = useRef<EarthRenderer | null>(null);
  const geoClient = useRef<GeoDatabaseClient | null>(null);
  const focusedLiveOrigin = useRef(false);
  const rememberedRoutes = useRef(new Map<string, RememberedRoute>());
  const [rendererError, setRendererError] = useState('');
  const [rotationPaused, setRotationPaused] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [showIP, setShowIP] = useState(false);
  const [hovered, setHovered] = useState<EarthEndpointInfo | null>(null);
  const [tooltip, setTooltip] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [feedStatus, setFeedStatus] = useState<MihomoFeedStatus>('connecting');
  const [feedMessage, setFeedMessage] = useState('Connecting to Nikki');
  const [connections, setConnections] = useState<LiveConnection[]>([]);
  const [routeCount, setRouteCount] = useState(0);
  const [displayRoutes, setDisplayRoutes] = useState<EarthRoute[]>(demoRoutes);
  const [publicOrigin, setPublicOrigin] = useState<PublicOrigin | null>(null);
  const [originError, setOriginError] = useState(false);
  const [geoStatus, setGeoStatus] = useState<GeoStatusSnapshot>(initialGeoStatus);
  const [originProvider, setOriginProvider] = useState<PublicOriginProvider>(() =>
    storedChoice('mihomo-globe-origin-provider', PUBLIC_ORIGIN_PROVIDERS, 'ipip.net'),
  );
  const [visualMode, setVisualMode] = useState<EarthVisualMode>(() =>
    storedChoice('mihomo-globe-visual-mode', ['space', 'flat'] as const, 'space'),
  );
  const [dimension, setDimension] = useState<ViewDimension>(() =>
    storedChoice('mihomo-globe-dimension', ['3d', '2d'] as const, '3d'),
  );
  const visualModeRef = useRef(visualMode);
  const reducedMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  useEffect(() => {
    let disposed = false;

    const initialize = async () => {
      try {
        const { createEarthRenderer } = await import('./globe/earthRenderer');
        if (!globeContainer.current || disposed) return;
        const instance = await createEarthRenderer(globeContainer.current, {
          reducedMotion,
          visualMode: visualModeRef.current,
          colorScheme: 'dark',
          onEndpointHover: (info, x, y) => {
            setHovered(info);
            if (x != null && y != null) setTooltip({ x, y });
          },
        });
        if (disposed) {
          instance.dispose();
          return;
        }
        renderer.current = instance;
        instance.setInitialLocation(demoOrigin);
        instance.setRoutes(demoRoutes);
      } catch (error) {
        console.error(error);
        setRendererError('This browser could not start the 3D Earth renderer.');
      }
    };

    void initialize();
    return () => {
      disposed = true;
      renderer.current?.dispose();
      renderer.current = null;
    };
  }, [reducedMotion]);

  useEffect(() => {
    const client = new GeoDatabaseClient(setGeoStatus);
    geoClient.current = client;
    return () => {
      client.dispose();
      geoClient.current = null;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void getPublicOrigin(originProvider, controller.signal)
      .then((value) => {
        setPublicOrigin(value);
        setOriginError(false);
      })
      .catch(() => setOriginError(true));
    return () => controller.abort();
  }, [originProvider]);

  useEffect(() => {
    visualModeRef.current = visualMode;
    window.localStorage.setItem('mihomo-globe-visual-mode', visualMode);
    renderer.current?.setVisualMode(visualMode);
  }, [visualMode]);

  useEffect(() => {
    window.localStorage.setItem('mihomo-globe-origin-provider', originProvider);
  }, [originProvider]);

  useEffect(() => {
    window.localStorage.setItem('mihomo-globe-dimension', dimension);
  }, [dimension]);

  useEffect(() => {
    const feed = new MihomoFeed({
      onConnections: setConnections,
      onStatus: (status, message) => {
        setFeedStatus(status);
        setFeedMessage(message);
      },
    });
    feed.start();
    return () => feed.dispose();
  }, []);

  useEffect(() => {
    let stale = false;
    const refresh = async () => {
      if (feedStatus !== 'live' || geoStatus.status !== 'ready' || !publicOrigin || !geoClient.current) {
        return;
      }

      try {
        const originHint =
          originProvider === 'ipip.net'
            ? null
            : {
                latitude: publicOrigin.latitude,
                longitude: publicOrigin.longitude,
                city: publicOrigin.city,
                country: publicOrigin.country,
              };
        const result = await buildEarthRoutes(
          connections,
          publicOrigin.ip,
          originHint,
          (ips, locale) => geoClient.current!.lookup(ips, locale),
        );
        if (stale) return;
        const now = Date.now();
        const activeKeys = new Set(result.routes.map((route) => route.key));

        for (const route of result.routes) {
          rememberedRoutes.current.set(route.key, { route, lastSeen: now });
        }

        const visibleRoutes: EarthRoute[] = [];
        for (const [key, remembered] of rememberedRoutes.current) {
          if (activeKeys.has(key)) {
            visibleRoutes.push(remembered.route);
          } else if (now - remembered.lastSeen < ROUTE_LINGER_MS) {
            visibleRoutes.push({
              ...remembered.route,
              connections: 0,
              upload: 0,
              download: 0,
            });
          } else {
            rememberedRoutes.current.delete(key);
          }
        }

        setRouteCount(result.routes.length);
        setDisplayRoutes(visibleRoutes);
        renderer.current?.setRoutes(visibleRoutes);
        if (result.origin && !focusedLiveOrigin.current) {
          focusedLiveOrigin.current = true;
          renderer.current?.setInitialLocation(result.origin);
        }
      } catch {
        if (!stale) {
          setRouteCount(0);
        }
      }
    };

    void refresh();
    return () => {
      stale = true;
    };
  }, [connections, feedStatus, geoStatus.status, originProvider, publicOrigin]);

  useEffect(() => {
    const handleFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handleFullscreen);
    return () => document.removeEventListener('fullscreenchange', handleFullscreen);
  }, []);

  const toggleRotation = () => {
    const next = !rotationPaused;
    setRotationPaused(next);
    renderer.current?.setAutoRotation(!next);
  };

  const toggleLabels = () => {
    const next = !showLabels;
    setShowLabels(next);
    renderer.current?.setCityLabelsVisible(next);
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  };

  const selectOriginProvider = (provider: PublicOriginProvider) => {
    if (provider === originProvider) return;
    focusedLiveOrigin.current = false;
    setPublicOrigin(null);
    setOriginError(false);
    setRouteCount(0);
    rememberedRoutes.current.clear();
    setDisplayRoutes(demoRoutes);
    renderer.current?.setRoutes(demoRoutes);
    setOriginProvider(provider);
  };

  const selectDimension = (next: ViewDimension) => {
    setDimension(next);
    if (next === '2d') setHovered(null);
  };

  const displayIP = publicOrigin?.ip ?? demoOrigin.ip;
  const isLive = feedStatus === 'live' && geoStatus.status === 'ready' && Boolean(publicOrigin);
  const progressTotal = geoStatus.total || DBIP_COMPRESSED_BYTES;
  const progress = Math.min(100, (geoStatus.received / Math.max(1, progressTotal)) * 100);

  return (
    <main className="globe-shell">
      <header className="topbar">
        <div className="brand-block">
          <p className="eyebrow">Global connections</p>
          <div className="signal-line" aria-label={isLive ? 'Live connection feed' : 'Demo connection feed'}>
            <span className={`live-dot ${isLive ? '' : 'is-demo'}`} />
            <span>{isLive ? `${connections.length} live connections` : 'Demo topology'}</span>
          </div>
        </div>

        <div className="controls" aria-label="Globe controls">
          <div className="dimension-switch" role="group" aria-label="Map dimension">
            <button
              type="button"
              className={dimension === '3d' ? 'active' : ''}
              aria-pressed={dimension === '3d'}
              onClick={() => selectDimension('3d')}
            >
              3D
            </button>
            <button
              type="button"
              className={dimension === '2d' ? 'active' : ''}
              aria-pressed={dimension === '2d'}
              onClick={() => selectDimension('2d')}
            >
              2D
            </button>
          </div>
          <SelectMenu
            ariaLabel="Earth visual style"
            className="visual-mode-menu"
            value={visualMode}
            options={visualModeOptions}
            onChange={(value) => setVisualMode(value as EarthVisualMode)}
          />
          <button
            className={`icon-button ${showLabels ? 'active' : ''}`}
            type="button"
            onClick={toggleLabels}
            aria-label={showLabels ? 'Hide city labels' : 'Show city labels'}
            title={showLabels ? 'Hide city labels' : 'Show city labels'}
          >
            ◉
          </button>
          <button
            className={`icon-button ${rotationPaused ? 'active' : ''}`}
            type="button"
            onClick={toggleRotation}
            disabled={dimension === '2d'}
            aria-label={rotationPaused ? 'Resume globe rotation' : 'Pause globe rotation'}
            title={rotationPaused ? 'Resume globe rotation' : 'Pause globe rotation'}
          >
            {rotationPaused ? '▶' : 'Ⅱ'}
          </button>
          <button
            className={`icon-button ${isFullscreen ? 'active' : ''}`}
            type="button"
            onClick={() => void toggleFullscreen()}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? '↙' : '⛶'}
          </button>
        </div>
      </header>

      <section
        className={`globe-stage visual-${visualMode} dimension-${dimension}`}
        aria-label="Interactive connection globe"
      >
        <div
          ref={globeContainer}
          className="globe-canvas"
          aria-hidden={dimension === '2d'}
        />
        {dimension === '2d' && <WorldMap2D routes={displayRoutes} showLabels={showLabels} />}

        <div className="identity-panel">
          <SelectMenu
            ariaLabel="Public IP provider"
            className="provider-menu"
            value={originProvider}
            options={providerOptions}
            onChange={(value) => selectOriginProvider(value as PublicOriginProvider)}
          />
          <span className="ip-pill">
            <span className="muted">Local IP</span>
            <code>{showIP ? displayIP : maskIP(displayIP)}</code>
            <button
              type="button"
              className="reveal-button"
              aria-label={showIP ? 'Hide local IP' : 'Show local IP'}
              onClick={() => setShowIP((value) => !value)}
            >
              {showIP ? '●' : '○'}
            </button>
          </span>
        </div>

        <div className="attribution">
          <a href="https://db-ip.com/db/lite.php" target="_blank" rel="noreferrer">
            DB-IP City Lite
          </a>
          <a href="https://www.solarsystemscope.com/textures/" target="_blank" rel="noreferrer">
            Solar System Scope · CC BY 4.0
          </a>
        </div>

        <div className="status-panel">
          <span className="status-label">Router feed</span>
          <strong>
            {isLive
              ? `${routeCount} mapped routes`
              : originError
                ? 'Public IP lookup unavailable'
                : feedMessage}
          </strong>
        </div>

        {(geoStatus.status === 'checking' || geoStatus.status === 'loading-cache') && (
          <div className="center-message compact-message">
            <span className="spinner" />
            Loading city mapping
          </div>
        )}

        {geoStatus.status === 'idle' && (
          <div className="center-message database-card">
            <span className="database-kicker">Private city mapping</span>
            <strong>Place live connections on the globe</strong>
            <p>
              Download the DB-IP City Lite database once. It stays inside this browser and requires about 62 MB to download.
            </p>
            <button type="button" onClick={() => geoClient.current?.download()}>
              Enable live city mapping
            </button>
          </div>
        )}

        {geoStatus.status === 'downloading' && (
          <div className="center-message database-card">
            <span className="database-kicker">Preparing city mapping</span>
            <strong>{Math.round(progress)}%</strong>
            <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
            <p>{formatBytes(geoStatus.received)} of {formatBytes(progressTotal)}</p>
            <button className="secondary-button" type="button" onClick={() => geoClient.current?.cancel()}>
              Cancel
            </button>
          </div>
        )}

        {geoStatus.status === 'error' && (
          <div className="center-message database-card error-message">
            <strong>City mapping needs attention</strong>
            <p>{geoErrorMessage[geoStatus.error ?? 'unknown']}</p>
            <button type="button" onClick={() => geoClient.current?.download()}>Try again</button>
          </div>
        )}

        {rendererError && <div className="center-message error-message">{rendererError}</div>}
      </section>

      {dimension === '3d' && hovered && (
        <aside
          className="endpoint-tooltip"
          style={{
            left: Math.min(window.innerWidth - 250, tooltip.x + 14),
            top: Math.min(window.innerHeight - 160, tooltip.y + 14),
          }}
        >
          <strong>{[hovered.city, hovered.country].filter(Boolean).join(', ')}</strong>
          <span>{hovered.connections} active connection{hovered.connections === 1 ? '' : 's'}</span>
          {hovered.topHosts.map((item) => (
            <div className="host-row" key={item.host}>
              <code>{item.host}</code>
              <span>{formatBytes(item.downloaded)}</span>
            </div>
          ))}
        </aside>
      )}
    </main>
  );
}
