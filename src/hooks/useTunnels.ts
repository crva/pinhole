import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Traffic, type TunnelInfo } from "@/api";

/** Per-second rates, one per poll. */
export interface Sample {
  t: number;
  rxPackets: number;
  txPackets: number;
  rxBytes: number;
  txBytes: number;
}

export interface PeerRate {
  rx: number;
  tx: number;
}

export interface TunnelView {
  info: TunnelInfo;
  /** Last HISTORY samples, oldest first. */
  history: Sample[];
  rate: Sample;
  peerRates: Record<string, PeerRate>;
}

const HISTORY = 60;
const POLL_MS = 1000;

const zeroSample = (t: number): Sample => ({ t, rxPackets: 0, txPackets: 0, rxBytes: 0, txBytes: 0 });

interface Previous {
  at: number;
  traffic: Traffic;
  peers: Record<string, Traffic>;
  history: Sample[];
  peerRates: Record<string, PeerRate>;
}

const perSec = (now: number, before: number, dt: number) => Math.max(0, now - before) / dt;

/**
 * Polls tunnel state from Rust once per second and turns the cumulative
 * traffic counters into per-second rates with a rolling history.
 */
export function useTunnels() {
  const [views, setViews] = useState<TunnelView[]>([]);
  const previous = useRef(new Map<number, Previous>());
  // Polls and post-action refreshes can overlap: an older answer arriving last is dropped.
  const requested = useRef(0);
  const applied = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++requested.current;
    const list = await api.list();
    if (request < applied.current) return;
    applied.current = request;
    const now = performance.now();
    const next = new Map<number, Previous>();

    const result = list.map((info): TunnelView => {
      const prev = previous.current.get(info.id);
      const peers = Object.fromEntries(info.connections.map((c) => [c.remote_id, c.traffic]));

      // Extra refreshes right after an action would produce noisy rates: keep the last sample.
      if (prev && now - prev.at < POLL_MS / 2) {
        next.set(info.id, prev);
        return { info, history: prev.history, rate: prev.history[prev.history.length - 1], peerRates: prev.peerRates };
      }

      let history = prev?.history ?? Array.from({ length: HISTORY }, (_, i) => zeroSample(i - HISTORY));
      const peerRates: Record<string, PeerRate> = {};
      if (prev) {
        const dt = (now - prev.at) / 1000;
        const sample: Sample = {
          t: history[history.length - 1].t + 1,
          rxPackets: perSec(info.traffic.rx_packets, prev.traffic.rx_packets, dt),
          txPackets: perSec(info.traffic.tx_packets, prev.traffic.tx_packets, dt),
          rxBytes: perSec(info.traffic.rx_bytes, prev.traffic.rx_bytes, dt),
          txBytes: perSec(info.traffic.tx_bytes, prev.traffic.tx_bytes, dt),
        };
        history = [...history.slice(1), sample];
        for (const [id, t] of Object.entries(peers)) {
          const before = prev.peers[id];
          if (before) peerRates[id] = { rx: perSec(t.rx_bytes, before.rx_bytes, dt), tx: perSec(t.tx_bytes, before.tx_bytes, dt) };
        }
      }

      next.set(info.id, { at: now, traffic: info.traffic, peers, history, peerRates });
      return { info, history, rate: history[history.length - 1], peerRates };
    });

    previous.current = next;
    setViews(result);
  }, []);

  useEffect(() => {
    const tick = () => refresh().catch(console.error);
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { tunnels: views, refresh };
}
