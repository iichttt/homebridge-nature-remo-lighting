# Homebridge Plugin for Nature Remo Light Devices

## What is this plugin?

This Homebridge accessory lets you control lights registered in your Nature Remo app directly from HomeKit. It supports 20%‑step dimming (0%, 20%, 40%, 60%, 80%, 100%) by sending the appropriate Nature Remo API commands:

- **0%** → `off`
- **20%** → `on` (recall last brightness)
- **40/60/80%** → multiple `bright-up` or `bright-down` presses
- **100%** → `on-100`

The slider in the Home app will snap to 20% increments for consistent behavior.

## Installation

Install via npm:

```bash
npm install -g homebridge-nature-remo-lighting
```

Then add the accessory to your `config.json` under `accessories`.

## Configuration

Add an entry like this:

```json
"accessories": [
  {
    "accessory": "NatureRemoLighting",
    "accessToken": "YOUR_SECRET_TOKEN",
    "id": "YOUR_DEVICE_ID",
    "name": "Living Room Light",
    "refreshInterval": 5000    // optional cache TTL in ms (default: 5000)
  }
]
```

### Parameters

- **accessory**: Must be `NatureRemoLighting`.
- **accessToken**: Your Nature Remo API token (from [https://home.nature.global](https://home.nature.global)).
- **id**: The appliance ID obtained from the Nature Remo API.
- **name**: Display name shown in the Home app.
- **refreshInterval** *(optional)*: Cache time‑to‑live for the appliances list in milliseconds (default: 5000).

## Retrieving Your Device ID

Run:

```bash
curl -H "Authorization: Bearer YOUR_SECRET_TOKEN" \
     https://api.nature.global/1/appliances | jq
```

Look for the `id` field under the light appliance you want to control.

## Command Mapping

HomeKit → Nature Remo API:

| Slider    | API Command                       |
| --------- | --------------------------------- |
| 0%        | off                               |
| 20%       | on                                |
| 40/60/80% | bright-up / bright-down (repeats) |
| 100%      | on-100                            |

The plugin automatically determines how many `bright-up` or `bright-down` presses are needed to reach the requested step.

## License

MIT
