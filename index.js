const axios = require('axios');
const querystring = require('querystring');
const semaphore = require('await-semaphore');

const mutex = new semaphore.Mutex();
let Service, Characteristic;
const BASE_URL = 'https://api.nature.global';

module.exports = (homebridge) => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerAccessory(
    'homebridge-nature-remo-lighting',
    'NatureRemoLighting',
    NatureRemoLighting
  );
};

class NatureRemoLighting {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;

    // 0: off, 20: low brightness, 100: full brightness
    this.brightness = 0;
    // Prevent duplicate or redundant API calls
    this.lastButton = null;

    if (api) {
      this.api.on('didFinishLaunching', () => this.log('Homebridge finished launching'));
    }
  }

  getServices() {
    const info = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'Nature, Inc.')
      .setCharacteristic(Characteristic.Model, 'NatureRemo')
      .setCharacteristic(Characteristic.SerialNumber, this.config.id);

    const bulb = new Service.Lightbulb(this.config.name);

    bulb.getCharacteristic(Characteristic.On)
      .on('get', cb => cb(null, this.brightness > 0))
      .on('set', this.handleSetOn.bind(this));

    bulb.getCharacteristic(Characteristic.Brightness)
      .on('get', cb => cb(null, this.brightness))
      .on('set', this.handleSetBrightness.bind(this));

    return [info, bulb];
  }

  // === Handle Power ON/OFF ===
  async handleSetOn(value, callback) {
    try {
      // Skip redundant Power ON if brightness already nonzero
      if (value && this.brightness > 0) {
        this.log(`Skipped redundant Power ON (brightness already ${this.brightness}%)`);
        callback(null);
        return;
      }

      const button = value ? 'on' : 'off';
      this.log(`Power ${value ? 'ON (Low 20%)' : 'OFF'}`);
      await this.httpRequest(button);
      this.brightness = value ? 20 : 0;
      callback(null);
    } catch (err) {
      this.log.error('Error in handleSetOn:', err);
      callback(err);
    }
  }

  // === Handle Brightness (3-level logic) ===
  async handleSetBrightness(value, callback) {
    try {
      let button;

      if (value === 0) {
        button = 'off';
      } else if (value <= 20) {
        button = 'on'; // Low brightness
      } else {
        button = 'on-100'; // Full brightness
      }

      this.log(`Set brightness: ${value}% → ${button}`);
      await this.httpRequest(button);

      // Normalize stored brightness to canonical levels
      this.brightness = value === 0 ? 0 : value <= 20 ? 20 : 100;
      callback(null);
    } catch (err) {
      this.log.error('Error in handleSetBrightness:', err);
      callback(err);
    }
  }

  // === Nature API communication (with duplicate suppression) ===
  async httpRequest(button) {
    // Skip sending if command identical to last
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
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );
      this.lastButton = button;
      this.log(`Sent '${button}'`);
    } finally {
      release();
    }
  }
}