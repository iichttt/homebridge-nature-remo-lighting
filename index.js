const request = require('request-promise-native');

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
    this.brightness = 100;
    this.dimming = this.full || this.night;
    this.lastcmd = config.full ? "on-100" : "on";

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
    callback(null, this.brightness);
  }

  async setBrightnessCharacteristicHandler(value, callback) {
    let buttonstr;
    if (this.night && value < 20) {
      buttonstr = 'night'
    } else if (this.full && value > 80) {
      buttonstr = 'on-100'
    } else {
      buttonstr = 'on'
    } 

    this.lastcmd = buttonstr;
    this.brightness = value;
    callback(null);
  }

  async getOnCharacteristicHandler(callback) {
    const options = {
      url: `${BASE_URL}/1/appliances`,
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
      },
    };
    let state = false;
    try {
      const responses = await request(options);
      const device = JSON.parse(responses).filter(
        res => res.id === this.config.id
      )[0];
      state = device.light.state.power === 'on';
    } catch (e) {
      this.log(e);
    }
    callback(null, state);
  }

  async setOnCharacteristicHandler(value, callback) {
    const options = {
      method: 'POST',
      url: `${BASE_URL}/1/appliances/${this.config.id}/light`,
      form: {
        button: value ? this.lastcmd : 'off',
      },
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
      },
    };
    await request(options, function (error, response, body) {
      if(error){
        this.log(error);
      }
    });
    callback(null);
  }
}
