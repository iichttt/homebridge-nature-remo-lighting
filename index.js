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
    this.brightness = -1;  // unknown until first GET
    this.state = null;
    this.api = api;

    // in-memory cache for appliances
    this.cache = {
      timestamp: 0,
      data: null,
      ttl: config.refreshInterval || 5000,
    };

    if (api) {
      this.api.on('didFinishLaunching', () => {
        this.log('Homebridge finished launching');
      });
    }
  }

  getServices() {
    const informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'Nature, Inc.')
      .setCharacteristic(Characteristic.Model, 'NatureRemo')
      .setCharacteristic(Characteristic.SerialNumber, this.config.id);

    const lightService = new Service.Lightbulb(this.config.name);

    lightService
      .getCharacteristic(Characteristic.On)
      .on('get', this.handleGetOn.bind(this))
      .on('set', this.handleSetOn.bind(this));

    // Always support brightness with 20% steps
    lightService
      .getCharacteristic(Characteristic.Brightness)
      .setProps({ minStep: 20 })
      .on('get', this.handleGetBrightness.bind(this))
      .on('set', this.handleSetBrightness.bind(this));

    return [informationService, lightService];
  }

  // fetch appliances list with TTL cache
  async fetchDevices() {
    const now = Date.now();
    if (this.cache.data && now - this.cache.timestamp < this.cache.ttl) {
      return this.cache.data;
    }
    const release = await mutex.acquire();
    try {
      const resp = await axios.get(
        `${BASE_URL}/1/appliances`,
        { headers: { Authorization: `Bearer ${this.config.accessToken}` } }
      );
      this.cache.data = resp.data;
      this.cache.timestamp = now;
      return this.cache.data;
    } finally {
      release();
    }
  }

  // GET handler for On
  async handleGetOn(callback) {
    try {
      this.log('Getting power status...');
      const devices = await this.fetchDevices();
      const device = devices.find(d => d.id === this.config.id);
      if (!device) throw new Error(`Device ${this.config.id} not found`);

      const isOn = device.light.state.power === 'on';
      this.state = device.light.state.last_button;
      this.brightness = isOn ? (this.brightness >= 20 ? this.brightness : 20) : 0;
      callback(null, isOn);
    } catch (err) {
      this.log.error('Error in handleGetOn:', err);
      callback(err);
    }
  }

  // SET handler for On
  async handleSetOn(value, callback) {
    try {
      this.log(`Setting power to ${value ? 'ON' : 'OFF'}`);
      const button = value ? 'on' : 'off';
      await this.httpRequest(button);
      this.state = button;
      this.brightness = value ? (this.brightness > 0 ? this.brightness : 20) : 0;
      callback(null);
    } catch (err) {
      this.log.error('Error in handleSetOn:', err);
      callback(err);
    }
  }

  // GET handler for Brightness
  async handleGetBrightness(callback) {
    try {
      if (this.brightness >= 0) {
        return callback(null, this.brightness);
      }
      const devices = await this.fetchDevices();
      const device = devices.find(d => d.id === this.config.id);
      if (!device) throw new Error(`Device ${this.config.id} not found`);
      const last = device.light.state.last_button;
      let pct = 0;
      switch (last) {
        case 'off':      pct = 0;   break;
        case 'on':       pct = 20;  break;
        case 'on-100':   pct = 100; break;
        default:         pct = 20;  break;
      }
      this.brightness = pct;
      callback(null, pct);
    } catch (err) {
      this.log.error('Error in handleGetBrightness:', err);
      callback(err);
    }
  }

  // SET handler for Brightness
  async handleSetBrightness(value, callback) {
    try {
      this.log(`Requested brightness: ${value}%`);
      const prevStep = Math.round((this.brightness < 0 ? 0 : this.brightness) / 20);
      const step = Math.round(value / 20);

      // OFF
      if (step === 0) {
        await this.httpRequest('off');
      }
      // Recall last‐level (20%)
      else if (step === 1) {
        await this.httpRequest('on');
      }
      // FULL ON (100%)
      else if (step === 5) {
        await this.httpRequest('on-100');
      }
      // Intermediate: step up/down
      else {
        const delta = step - prevStep;
        const button = delta > 0 ? 'bright-up' : 'bright-down';
        for (let i = 0; i < Math.abs(delta); i++) {
          await this.httpRequest(button);
        }
      }

      this.brightness = step * 20;
      callback(null, this.brightness);
    } catch (err) {
      this.log.error('Error in handleSetBrightness:', err);
      callback(err);
    }
  }

  // Helper: send a light command
  async httpRequest(button) {
    const release = await mutex.acquire();
    try {
      await axios.post(
        `${BASE_URL}/1/appliances/${this.config.id}/light`,
        querystring.stringify({ button }),
        { headers: {
            Authorization: `Bearer ${this.config.accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );
    } finally {
      release();
      this.log(`Sent '${button}' to Nature Remo`);
    }
  }
}

