export type MihomoFeedStatus = 'connecting' | 'live' | 'offline';

export interface MihomoMetadata {
  destinationIP?: string;
  destinationPort?: string | number;
  host?: string;
  network?: string;
  process?: string;
  processPath?: string;
  sourceIP?: string;
}

interface MihomoRawConnection {
  id: string;
  metadata?: MihomoMetadata;
  upload?: number;
  download?: number;
}

interface MihomoConnectionResponse {
  connections: MihomoRawConnection[];
}

export interface LiveConnection {
  id: string;
  metadata: MihomoMetadata;
  upload: number;
  download: number;
  uploadSpeed: number;
  downloadSpeed: number;
}

interface ByteSample {
  upload: number;
  download: number;
  sampledAt: number;
}

interface FeedListeners {
  onConnections: (connections: LiveConnection[]) => void;
  onStatus: (status: MihomoFeedStatus, message: string) => void;
}

const API_URL = './cgi-bin/mihomo-globe-api?path=connections';
// Mihomo's native connection WebSocket updates roughly once per second.
// Poll at the same cadence so the 0.85s route streak does not sit dark between snapshots.
const POLL_INTERVAL = 1_000;

export class MihomoFeed {
  private timer: number | null = null;
  private controller: AbortController | null = null;
  private readonly previous = new Map<string, ByteSample>();
  private disposed = false;

  constructor(private readonly listeners: FeedListeners) {}

  start() {
    this.listeners.onStatus('connecting', 'Connecting to Nikki');
    void this.poll();
  }

  private schedule() {
    if (this.disposed) return;
    this.timer = window.setTimeout(() => void this.poll(), POLL_INTERVAL);
  }

  private async poll() {
    if (this.disposed) return;
    this.controller = new AbortController();
    const timeout = window.setTimeout(() => this.controller?.abort(), 5_000);

    try {
      const response = await fetch(API_URL, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: this.controller.signal,
      });
      if (!response.ok) throw new Error(`Bridge returned ${response.status}`);
      const payload = (await response.json()) as MihomoConnectionResponse;
      if (!Array.isArray(payload.connections)) {
        throw new Error('Bridge returned an invalid connection payload');
      }
      const now = Date.now();
      const nextSamples = new Map<string, ByteSample>();
      const connections: LiveConnection[] = [];

      for (const raw of payload.connections) {
        if (!raw.id || !raw.metadata?.destinationIP) continue;
        const upload = Math.max(0, Number(raw.upload) || 0);
        const download = Math.max(0, Number(raw.download) || 0);
        const old = this.previous.get(raw.id);
        const elapsed = old ? Math.max(0.25, (now - old.sampledAt) / 1_000) : 1;
        const uploadSpeed = old ? Math.max(0, upload - old.upload) / elapsed : 0;
        const downloadSpeed = old ? Math.max(0, download - old.download) / elapsed : 0;

        nextSamples.set(raw.id, { upload, download, sampledAt: now });
        connections.push({
          id: raw.id,
          metadata: raw.metadata,
          upload,
          download,
          uploadSpeed,
          downloadSpeed,
        });
      }

      this.previous.clear();
      for (const [id, sample] of nextSamples) this.previous.set(id, sample);
      this.listeners.onConnections(connections);
      this.listeners.onStatus('live', `${connections.length} active connections`);
    } catch (error) {
      if (!this.disposed) {
        this.listeners.onStatus(
          'offline',
          error instanceof Error && !error.name.includes('Abort')
            ? 'OpenWrt bridge unavailable'
            : 'Nikki did not respond',
        );
      }
    } finally {
      window.clearTimeout(timeout);
      this.controller = null;
      this.schedule();
    }
  }

  dispose() {
    this.disposed = true;
    if (this.timer != null) window.clearTimeout(this.timer);
    this.controller?.abort();
    this.previous.clear();
  }
}
