import earthDayTexture from './assets/earth/earth-day.webp';
import type { EarthLocation, EarthRoute } from './globe/types';

interface WorldMap2DProps {
  routes: EarthRoute[];
  showLabels: boolean;
}

interface MapEndpoint extends EarthLocation {
  connections: number;
  role: 'origin' | 'destination';
}

const WIDTH = 1_200;
const HEIGHT = 600;

const project = ({ latitude, longitude }: Pick<EarthLocation, 'latitude' | 'longitude'>) => ({
  x: ((longitude + 180) / 360) * WIDTH,
  y: ((90 - latitude) / 180) * HEIGHT,
});

const routePaths = (from: EarthLocation, to: EarthLocation) => {
  const start = project(from);
  const end = project(to);
  let destinationX = end.x;

  if (Math.abs(destinationX - start.x) > WIDTH / 2) {
    destinationX += destinationX > start.x ? -WIDTH : WIDTH;
  }

  return [-WIDTH, 0, WIDTH].map((offset) => {
    const x1 = start.x + offset;
    const x2 = destinationX + offset;
    const distance = Math.hypot(x2 - x1, end.y - start.y);
    const controlX = (x1 + x2) / 2;
    const controlY = (start.y + end.y) / 2 - Math.min(115, Math.max(24, distance * 0.18));
    return `M ${x1.toFixed(1)} ${start.y.toFixed(1)} Q ${controlX.toFixed(1)} ${controlY.toFixed(1)} ${x2.toFixed(1)} ${end.y.toFixed(1)}`;
  });
};

const aggregateEndpoints = (routes: EarthRoute[]) => {
  const endpoints = new Map<string, MapEndpoint>();

  for (const route of routes) {
    for (const point of route.path) {
      const key = `${point.role}:${point.latitude.toFixed(3)}:${point.longitude.toFixed(3)}`;
      const existing = endpoints.get(key);
      if (existing) existing.connections += route.connections;
      else endpoints.set(key, { ...point, connections: route.connections });
    }
  }

  return [...endpoints.values()].sort((a, b) => b.connections - a.connections);
};

export function WorldMap2D({ routes, showLabels }: WorldMap2DProps) {
  const endpoints = aggregateEndpoints(routes);

  return (
    <div
      className="world-map-view"
      role="img"
      aria-label={`Two-dimensional world map showing ${routes.length} connection routes`}
    >
      <div className="world-map-frame">
        <img src={earthDayTexture} alt="" aria-hidden="true" />
        <div className="world-map-shade" />
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <defs>
            <filter id="route-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <g className="map-routes">
            {routes.slice(0, 120).flatMap((route, routeIndex) => {
              const [from, to] = route.path;
              if (!from || !to) return [];
              return routePaths(from, to).map((path, copyIndex) => (
                <path
                  className="map-route"
                  d={path}
                  key={`${route.key}:${copyIndex}`}
                  pathLength="1"
                  style={{
                    animationDelay: `${-((routeIndex % 17) * 0.17).toFixed(2)}s`,
                    strokeWidth: Math.min(3.4, 1.05 + Math.log2(route.connections + 1) * 0.46),
                  }}
                />
              ));
            })}
          </g>

          <g className="map-endpoints">
            {endpoints.slice(0, 80).map((endpoint) => {
              const { x, y } = project(endpoint);
              const radius = endpoint.role === 'origin' ? 6.5 : Math.min(6, 2.7 + Math.log2(endpoint.connections + 1));
              return (
                <g key={`${endpoint.role}:${x}:${y}`} transform={`translate(${x} ${y})`}>
                  <title>{`${endpoint.city || endpoint.country || endpoint.ip}: ${endpoint.connections} connections`}</title>
                  <circle className={`map-endpoint-halo ${endpoint.role}`} r={radius * 2.1} />
                  <circle className={`map-endpoint-dot ${endpoint.role}`} r={radius} />
                  {showLabels && endpoint.city && (
                    <text className="map-city-label" x="9" y="-8">
                      {endpoint.city}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}
