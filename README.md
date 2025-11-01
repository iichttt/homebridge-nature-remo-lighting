# Homebridge Plugin for Nature Remo Light Devices

## Overview
This Homebridge accessory enables direct HomeKit control of your Nature Remo–registered lights. It implements a simplified three-level brightness model that maps HomeKit brightness values to Nature Remo API commands:

- **0%** → `off`  
- **1–20%** → `on` (low brightness)  
- **21–100%** → `on-100` (full brightness)

The plugin minimizes API communication by sending commands only when the state actually changes.

## Installation
Install globally with npm:

```bash
npm install -g homebridge-nature-remo-lighting
```

Then add the accessory configuration to your `config.json` under the `accessories` section.

## Configuration Example
```json
"accessories": [
  {
    "accessory": "NatureRemoLighting",
    "accessToken": "YOUR_SECRET_TOKEN",
    "id": "YOUR_DEVICE_ID",
    "name": "Living Room Light",
    "refreshInterval": 5000
  }
]
```

### Parameters
- **accessory**: Must be `"NatureRemoLighting"`.
- **accessToken**: Your Nature Remo API token from [https://home.nature.global](https://home.nature.global).
- **id**: The appliance ID of the target light, retrievable through the API.
- **name**: The display name for the accessory in the Home app.
- **refreshInterval** *(optional)*: Cache time-to-live in milliseconds (default: 5000).

## Retrieving the Appliance ID
Run the following command to list your appliances and find the `id` of your target light:
```bash
curl -H "Authorization: Bearer YOUR_SECRET_TOKEN" \
     https://api.nature.global/1/appliances | jq
```

## Behavior Summary

| HomeKit Brightness | Nature Remo Command | Description       |
|--------------------|--------------------|-------------------|
| 0%                 | off                | Turn off light    |
| 1–20%              | on                 | Low brightness    |
| 21–100%            | on-100             | Full brightness   |

### Optimization
The plugin tracks the last command sent (`on`, `on-100`, or `off`) and suppresses redundant requests, ensuring minimal interaction with the Nature Remo API.

## License
MIT