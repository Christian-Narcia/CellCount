/**
 * detector.worker.js — Runs detection off the main thread, independently per
 * channel, then (later) co-localization. Module worker so it imports the same
 * pure algorithm code the rest of the app uses — no duplicated logic.
 *
 * Message protocol
 *   Main → Worker:  {
 *                     channels: { r: ArrayBuffer|null, g, b, gray },  // Float32 grayscale
 *                     mask: ArrayBuffer|null,                          // Uint8 0/1
 *                     width, height,
 *                     params,                       // global detection params
 *                     channelParams,                // { [key]: { R, Dmin, T } } per-channel
 *                   }
 *                   (every non-null buffer is transferred — see main.js)
 *   Worker → Main:  { ok: true, perChannel: { r: cells, g: cells, ... }, took }
 *                |  { ok: false, error }
 *
 * PER-CHANNEL PARAMS (Phase 9): every channel is detected with the global
 * `params` overridden by that channel's `channelParams[key]` (R/Dmin/T). The
 * merge happens here so the main thread only ships the per-channel values, not a
 * fully-resolved set per channel.
 */

import { detectChannel } from '../algorithm/detect.js';

self.onmessage = (e) => {
  const { channels, mask, width, height, params, channelParams } = e.data;
  try {
    const t0 = performance.now();
    const maskArr = mask ? new Uint8Array(mask) : null;

    const perChannel = {};
    for (const key of Object.keys(channels)) {
      const buf = channels[key];
      if (!buf) continue;
      const gray = new Float32Array(buf);
      const p =
        channelParams && channelParams[key]
          ? { ...params, ...channelParams[key] }
          : params;
      perChannel[key] = detectChannel(gray, width, height, p, maskArr);
    }

    const took = performance.now() - t0;
    self.postMessage({ ok: true, perChannel, took });
  } catch (error) {
    self.postMessage({ ok: false, error: String((error && error.message) || error) });
  }
};
