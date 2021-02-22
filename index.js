const request = require('request-promise-native');
const semaphore = require('await-semaphore');
const mutex = new semaphore.Mutex();

let Service, Characteristic;

const BASE_URL = 'https://api.nature.global';

module.exports = homebridge => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerAccessory(
    'homebridge-nature-remo-lights-ext',
    'NatureRemoLightDeviceExt',
    NatureRemoLightDevice
  );
};

class NatureRemoLightDevice {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.full = config.full;
    this.night = config.night;
    this.brightness = -1;
    this.dimming = this.full || this.night;

    this.state_to = config.full ? "on-100" : "on";
    this.state;

    if (api) {
      this.api = api;
      this.api.on('didFinishLaunching', () => {
        this.log('DidFinishLaunching');
      });
    }
  }

  getServices() {
    const informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'Nature, Inc.')
      .setCharacteristic(Characteristic.Model, 'NatureRemo')
      .setCharacteristic(Characteristic.SerialNumber, 'nature-remo');

    const lightBulb = new Service.Lightbulb(this.config.name);
    lightBulb
      .getCharacteristic(Characteristic.On)
      .on('get', this.getOnCharacteristicHandler.bind(this))
      .on('set', this.setOnCharacteristicHandler.bind(this));

    if (this.dimming) {
      lightBulb.getCharacteristic(Characteristic.Brightness)
        .on('get', this.getBrightnessCharacteristicHandler.bind(this))
        .on('set', this.setBrightnessCharacteristicHandler.bind(this));
    }
    return [informationService, lightBulb];
  }

  async getBrightnessCharacteristicHandler(callback) {
    this.log("get brightness.");
    if (this.brightness < 0) {
      const options = {
        url: `${BASE_URL}/1/appliances`,
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
        },
      };
      try {
        const responses = await request(options);
        const device = JSON.parse(responses).filter(
          res => res.id === this.config.id
        )[0];
        this.state = device.light.state.last_button;
        if (this.state == "nigth") {
          this.brightness = 10;
        } else if (this.state == "on-100") {
          this.brightness = 100;
        } else if (this.state == "on") {
          this.brightness = 50;
        } else if (this.state == "off") {
          this.brightness = 0;
        }
        this.log("retrieved light state from nature remo cloud.  last_button:" + this.state);
        callback(null, this.brightness);
      } catch (e) {
        this.log(e);
        callback(e);
      }
    } else {
      callback(null, this.brightness);
    }
  }

  async setBrightnessCharacteristicHandler(value, callback) {
    this.log("set brightness:" + value);
    if (this.night && value < 20) {
      this.state_to = 'night'
    } else if (this.full && value > 80) {
      this.state_to = 'on-100'
    } else {
      this.state_to = 'on'
    }

    if (this.state != this.state_to) {
      this.log("local state is different from cloud state.");
      const options = {
        method: 'POST',
        url: `${BASE_URL}/1/appliances/${this.config.id}/light`,
        form: {
          button: this.state_to,
        },
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
        },
      };
      // send http request sync
      await this.httpRequestSerialized(options, callback, value, () => {
        this.state = this.state_to;
        this.brightness = value;
      });
    } else {
      this.brightness = value;
      callback(null, this.brightness);
    }
  }

  async getOnCharacteristicHandler(callback) {
    this.log("get power status.");
    const options = {
      url: `${BASE_URL}/1/appliances`,
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
      },
    };
    let result = false;
    try {
      const responses = await request(options);
      const device = JSON.parse(responses).filter(
        res => res.id === this.config.id
      )[0];
      result = device.light.state.power === 'on';
      this.state = device.light.state.last_button;
      this.log("retrieved light state from nature remo cloud. power:" + result + " last_button:" + this.state);
      callback(null, result);
    } catch (e) {
      this.log(e);
      callback(e);
    }
  }

  async setOnCharacteristicHandler(value, callback) {
    this.log("setting power state.");

    const options = {
      method: 'POST',
      url: `${BASE_URL}/1/appliances/${this.config.id}/light`,
      form: {
        button: value ? this.state_to : 'off',
      },
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
      }
    };
    await this.httpRequestSerialized(options, callback, value, () => {
      this.state = value ? this.state_to : 'off';
    }, false);
  }

  async httpRequestSerialized(option, callback, value, statehandler) {
    let release;
    try {
      release = await mutex.acquire();
      let response = await request(option);
      statehandler();
      callback(null);
    } catch (e) {
      this.log(e);
      callback(e);
    } finally {
      this.log(`sent ${option.form.button} button operation to nature remo cloud.`);
      release();
    }
  }
}
