// index.js
// Homebridge accessory: Nature Remo Lighting (coalesced + responsive, using APPLIANCE IDs)
//
// This version uses Nature Remo "appliance" endpoints (no /signals IDs needed).
// For LIGHT appliances we POST button presses to:
//   POST https://api.nature.global/1/appliances/{applianceId}/light
// with body: button=on|off|on-100|night|bright-up|bright-down
//
// Extra config knobs:
//  - applianceId: REQUIRED (from /1/appliances response for each LIGHT)
//  - token: REQUIRED (Nature Remo access token)
//  - lowLevel: percent for the "on" (low light) bucket (default 20)
//  - debounceMs: base coalescing window while user is sliding (default 220)
//  - fastDebounceMs: used for "final" levels 0/low/100 (default 80)
//  - fireAndForget: if true, don't await HTTP (default false)
//  - keepAliveConnections: HTTP keep-alive pool size (default 4)
//  - buttonMap: optional overrides if your remote uses different names
//      {
//        "low": "on",
//        "full": "on-100",
//        "off": "off"
//      }

let Service, Characteristic, HapStatusError, HAPStatus;

// --- undici keep-alive for global fetch (Node 18+ uses undici under the hood)
try {
  const { setGlobalDispatcher, Agent } = require('undici');
  setGlobalDispatcher(new Agent({
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 60_000,
    connections: 4, // overridden by config.keepAliveConnections if set
    connect: { timeout: 5000 }
  }));
} catch {
  // undici not available; fine, just skip keep-alive tuning
}

module.exports = (api) => {
  Service = api.hap.Service;
  Characteristic = api.hap.Characteristic;
  HapStatusError = api.hap.HapStatusError;
  HAPStatus = api.hap.HAPStatus;

  api.registerAccessory('homebridge-nature-remo-lighting', 'NatureRemoLighting', NatureRemoLightingAccessory);
};

class NatureRemoLightingAccessory {
  constructor(log, config) {
    this.log = log;
    this.name = config.name || 'Nature Remo Light';
    this.token = config.token;
    this.applianceId = config.applianceId;
    this.lowLevel = numOr(config.lowLevel, 20);
    this.debounceMs = numOr(config.debounceMs, 220);
    this.fastDebounceMs = numOr(config.fastDebounceMs, 80);
    this.fireAndForget = !!config.fireAndForget;
    this.keepAliveConnections = numOr(config.keepAliveConnections, 4);
    this.httpTimeoutMs = numOr(config.httpTimeoutMs, 4000);
    this.retries = numOr(config.retries, 2);
    this.forceIPv4 = !!config.forceIPv4; // reserved for future use
    this.buttonMap = Object.assign(
      { low: 'on', full: 'on-100', off: 'off' },
      config.buttonMap || {}
    );

    // If user set keepAliveConnections and undici is present, re-set dispatcher
    try {
      const { setGlobalDispatcher, Agent } = require('undici');
      setGlobalDispatcher(new Agent({
        keepAliveTimeout: 30_000,
        keepAliveMaxTimeout: 60_000,
        connections: this.keepAliveConnections,
        connect: { timeout: 5000 }
      }));
    } catch {}

    if (!this.token) {
      this.log.warn(`[${this.name}] No Nature Remo token set. Commands will be skipped.`);
    }
    if (!this.applianceId) {
      this.log.warn(`[${this.name}] 'applianceId' not configured. Find it in /1/appliances and set it in config.json.`);
    }

    // HomeKit service/characteristics
    this.service = new Service.Lightbulb(this.name);
    this.service.getCharacteristic(Characteristic.On)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this));

    this.service.getCharacteristic(Characteristic.Brightness)
      .onSet(this.setBrightness.bind(this))
      .onGet(this.getBrightness.bind(this));

    // Internal state
    this.currentOn = false;
    this.currentBrightness = 100;
    this.lastEffectiveLevel = 0;

    // Coalescing + queue
    this.pending = null;         // { on: boolean, brightness: number|null }
    this.applyTimer = null;
    this.inFlight = false;       // true while HTTP is in flight
    this.replaceAfterFlight = null; // latest target to apply right after current HTTP finishes
  }

  // ---------- HomeKit handlers ----------

  async setOn(value) {
    this.currentOn = !!value;
    this.queueTarget({ on: this.currentOn, brightness: null });
  }

  async setBrightness(value) {
    const v = clampInt(value, 1, 100);
    this.currentBrightness = v;
    this.queueTarget({ on: true, brightness: v });
  }

  async getOn() { return this.currentOn; }
  async getBrightness() { return this.currentBrightness; }

  // ---------- Coalescing / Queue ----------

  queueTarget(partial) {
    // Merge into pending target
    if (!this.pending) {
      this.pending = { on: (typeof partial.on === 'boolean') ? partial.on : this.currentOn, brightness: null };
    }
    if (typeof partial.on === 'boolean') this.pending.on = partial.on;
    if (typeof partial.brightness === 'number') this.pending.brightness = partial.brightness;

    // Adaptive debounce: use faster window for "final" bucket values (0/low/100)
    const eff = this.computeEffective(this.pending);
    const delay = (eff === 0 || eff === this.lowLevel || eff === 100) ? this.fastDebounceMs : this.debounceMs;

    if (this.applyTimer) clearTimeout(this.applyTimer);
    this.applyTimer = setTimeout(() => this.applyPending().catch(e => this.log.error(e?.stack || String(e))), delay);
  }

  computeEffective(target) {
    const on = !!target.on;
    if (!on) return 0;
    const level = clampInt(target.brightness ?? this.currentBrightness ?? this.lowLevel, 1, 100);
    return normalizeLevel(level, this.lowLevel);
  }

  async applyPending() {
    this.applyTimer = null;
    const target = this.pending;
    this.pending = null;
    if (!target) return;

    const effectiveLevel = this.computeEffective(target);

    // Same-level skip
    if (effectiveLevel === this.lastEffectiveLevel) {
      this.debugLog(`Skipping (same level ${effectiveLevel}%)`);
      return;
    }

    // If a previous HTTP send is in flight, remember only the latest target
    if (this.inFlight) {
      this.replaceAfterFlight = effectiveLevel;
      this.debugLog(`HTTP in flight; queued latest target ${effectiveLevel}%`);
      return;
    }

    await this.applyLevel(effectiveLevel);
  }

  async applyLevel(effectiveLevel) {
    // Optimistic state update for "snappiness" in Home UI
    this.lastEffectiveLevel = effectiveLevel;
    this.currentOn = effectiveLevel > 0;
    if (effectiveLevel > 0) this.currentBrightness = effectiveLevel;

    // Decide "button" to press via buttonMap (two-bucket: <=low => low, else => full)
    let button;
    if (effectiveLevel === 0) {
      this.infoLog(`Turning off`);
      button = this.buttonMap.off || 'off';
    } else if (effectiveLevel <= this.lowLevel) {
      this.infoLog(`Low light (${this.lowLevel}%)`);
      button = this.buttonMap.low || 'on';
    } else {
      this.infoLog(`Full brightness (100%)`);
      button = this.buttonMap.full || 'on-100';
    }

    // Send command (with replace-latest behavior)
    this.inFlight = true;
    const sendPromise = this.sendLightButton(button).catch(e => {
      this.log.error(`[${this.name}] Send failed for '${button}': ${e.message || e}`);
    });

    if (this.fireAndForget) {
      // Do not await; but still chain "after flight" logic
      sendPromise.finally(() => this.afterFlight());
    } else {
      await sendPromise.finally(() => this.afterFlight());
    }
  }

  async afterFlight() {
    this.inFlight = false;
    if (this.replaceAfterFlight != null) {
      const next = this.replaceAfterFlight;
      this.replaceAfterFlight = null;

      // If another pending came in meanwhile, compute the freshest target
      if (this.pending) {
        const eff = this.computeEffective(this.pending);
        // Prefer the most recent (pending) over stored replace value
        await this.applyLevel(eff);
      } else {
        await this.applyLevel(next);
      }
    }
  }

  // ---------- Sending using APPLIANCE endpoint ----------

  async sendLightButton(button) {
    if (!this.token) {
      this.log.warn(`[${this.name}] (dry-run) Would send button='${button}' (no token configured)`);
      return;
    }
    if (!this.applianceId) {
      this.log.warn(`[${this.name}] (dry-run) Would send button='${button}' (no applianceId configured)`);
      return;
    }

    const url = `https://api.nature.global/1/appliances/${encodeURIComponent(this.applianceId)}/light`;
    const body = `button=${encodeURIComponent(button)}`;
    let attempt = 0;
    let backoff = 250;
    const maxAttempts = Math.max(1, this.retries + 1);

    while (attempt < maxAttempts) {
      const start = Date.now();
      const ac = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      let timer = null;
      try {
        if (ac) {
          timer = setTimeout(() => ac.abort(), this.httpTimeoutMs);
        }
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body,
          signal: ac ? ac.signal : undefined
        });
        const ms = Date.now() - start;

        if (!res.ok) {
          let text = '';
          try { text = await res.text(); } catch {}
          throw new Error(`HTTP ${res.status} ${res.statusText} (${ms}ms): ${text}`);
        }
        this.log.info(`[${this.name}] Sent button='${button}' (${ms}ms)`);
        return; // success
      } catch (e) {
        if (timer) clearTimeout(timer);
        const code = e && (e.code || e.name || e.type);
        const isAbort = (e && (e.name === 'AbortError' || code === 'ABORT_ERR'));
        const ms = Date.now() - start;
        const detail = e && e.message ? e.message : String(e);
        if (attempt < maxAttempts - 1) {
          this.log.warn(`[${this.name}] Attempt ${attempt + 1} failed for '${button}' (${ms}ms): ${detail}. Retrying in ${backoff}ms...`);
          await new Promise(r => setTimeout(r, backoff));
          backoff = Math.min(backoff * 2, 2000);
          attempt++;
          continue;
        } else {
          this.log.error(`[${this.name}] Send failed for '${button}' after ${maxAttempts} attempt(s) (${ms}ms): ${detail}`);
          throw e;
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  }

  // ---------- Homebridge ----------

  getServices() {
    const informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'Nature Remo + Homebridge')
      .setCharacteristic(Characteristic.Model, 'Lighting (Coalesced/Responsive, ApplianceIDs)')
      .setCharacteristic(Characteristic.SerialNumber, 'NRL-RESP-APPL-1');
    return [informationService, this.service];
  }

  // ---------- Logs ----------
  infoLog(msg) { this.log.info(`[${this.name}] ${msg}`); }
  debugLog(msg) { this.log.debug(`[${this.name}] ${msg}`); }
}

// ---------- Utils ----------
function clampInt(n, min, max) {
  n = Math.round(Number(n));
  if (!Number.isFinite(n)) n = min;
  return Math.max(min, Math.min(max, n));
}
function normalizeLevel(level, low) {
  if (level <= 0) return 0;
  if (level <= low) return low;
  return 100;
}
function numOr(v, dflt) {
  return Number.isFinite(Number(v)) ? Number(v) : dflt;
}
// Note: forceIPv4 is reserved for future use (custom DNS lookup); current Agent uses default OS resolution.