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
    this.brightness = 0;  // start at off
    this.api = api;

    this.cache = { timestamp: 0, data: null, ttl: config.refreshInterval || 5000 };

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
      .setProps({ minStep: 10 })
      .on('get', cb => cb(null, this.brightness))
      .on('set', this.handleSetBrightness.bind(this));

    return [info, bulb];
  }

  // SET On: true => full, false => off
  async handleSetOn(value, callback) {
    try {
      const button = value ? 'on-100' : 'off';
      this.log(`Power ${value ? 'ON(100%)' : 'OFF'}`);
      await this.httpRequest(button);
      this.brightness = value ? 100 : 0;
      callback(null);
    } catch (err) {
      this.log.error('Error in handleSetOn:', err);
      callback(err);
    }
  }

  // SET Brightness in 10% steps
  async handleSetBrightness(value, callback) {
    try {
      this.log(`Requested brightness: ${value}%`);
      const prev = this.brightness;
      const step = Math.round(value / 10);

      if (step === 0) {
        await this.httpRequest('off');
      } else if (step === 10) {
        await this.httpRequest('on-100');
      } else {
        const prevStep = Math.round(prev / 10);
        const delta = step - prevStep;
        const button = delta > 0 ? 'bright-up' : 'bright-down';
        for (let i = 0; i < Math.abs(delta); i++) await this.httpRequest(button);
      }

      this.brightness = step * 10;
      callback(null);
    } catch (err) {
      this.log.error('Error in handleSetBrightness:', err);
      callback(err);
    }
  }

  // Helper HTTP
  async httpRequest(button) {
    const release = await mutex.acquire();
    try {
      await axios.post(
        `${BASE_URL}/1/appliances/${this.config.id}/light`,
        querystring.stringify({ button }),
        { headers: { Authorization: `Bearer ${this.config.accessToken}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
    } finally {
      release();
      this.log(`Sent '${button}'`);
    }
  }
}
