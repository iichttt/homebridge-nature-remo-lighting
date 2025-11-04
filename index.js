const axios = require("axios");
const querystring = require("querystring");
const semaphore = require("await-semaphore");

const mutex = new semaphore.Mutex();
let Service, Characteristic;
const BASE_URL = "https://api.nature.global";

module.exports = (homebridge) => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerAccessory(
    "homebridge-nature-remo-lighting",
    "NatureRemoLighting",
    NatureRemoLighting
  );
};

class NatureRemoLighting {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;

    // 0 = off, 20 = low light, 100 = full brightness
    this.brightness = 0;
    this.lastButton = null;

    if (api) {
      this.api.on("didFinishLaunching", () => this.log("Homebridge finished launching"));
    }
  }

  getServices() {
    const info = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, "Nature, Inc.")
      .setCharacteristic(Characteristic.Model, "NatureRemo")
      .setCharacteristic(Characteristic.SerialNumber, this.config.id);

    const bulb = new Service.Lightbulb(this.config.name);

    // On characteristic is derived from brightness > 0
    bulb.getCharacteristic(Characteristic.On)
      .on("get", (cb) => cb(null, this.brightness > 0))
      .on("set", (value, cb) => {
        const target = value ? (this.brightness === 0 ? 20 : this.brightness) : 0;
        this.handleSetBrightness(target, cb);
      });

    bulb.getCharacteristic(Characteristic.Brightness)
      .on("get", (cb) => cb(null, this.brightness))
      .on("set", this.handleSetBrightness.bind(this));

    return [info, bulb];
  }

  // === Unified Brightness Control ===
  async handleSetBrightness(value, callback) {
    try {
      // Quantize to 3 levels: 0 / 20 / 100
      const newLevel = value === 0 ? 0 : value <= 20 ? 20 : 100;
      if (newLevel === this.brightness) {
        this.log(`Skipped brightness ${value}% (same level ${this.brightness}%)`);
        callback(null);
        return;
      }

      let button, desc;
      if (newLevel === 0) {
        button = "off";
        desc = "Turn off";
      } else if (newLevel === 20) {
        button = "on";
        desc = "Low light (20%)";
      } else {
        button = "on-100";
        desc = "Full brightness (100%)";
      }

      this.log(`${desc}`);
      await this.httpRequest(button);
      this.brightness = newLevel;
      callback(null);
    } catch (err) {
      this.log.error("Error in handleSetBrightness:", err);
      callback(err);
    }
  }

  // === Nature API with duplicate suppression ===
  async httpRequest(button) {
    if (this.lastButton === button) {
      this.log(`Skipped '${button}' (no change)`);
      return;
    }

    const release = await mutex.acquire();
    try {
      await axios.post(
        `${BASE_URL}/1/appliances/${this.config.id}/light`,
        querystring.stringify({ button }),
        {
          headers: {
            Authorization: `Bearer ${this.config.accessToken}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );
      this.lastButton = button;
      this.log(`Sent '${button}'`);
    } finally {
      release();
    }
  }
}