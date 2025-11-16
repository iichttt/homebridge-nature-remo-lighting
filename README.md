# Homebridge Plugin for Nature Remo Light Devices

## Overview
This Homebridge accessory enables direct HomeKit control of Nature Remo–registered lights using the Nature Cloud appliance endpoint (no IR signal IDs required).

It implements a two-bucket brightness model with a configurable threshold:

- 0% → off
- 1–LOW% → on (Low light)
- (LOW+1)–100% → on-100 (Full brightness)

Where LOW is the lowLevel value in your configuration (default: 20).

The plugin also coalesces rapid On + Brightness updates from HomeKit so scenes issue one command instead of two.

## Key Features
- Appliance-ID based control (no IR signals)
- Coalesced writes: merges simultaneous HomeKit updates
- Two-bucket brightness logic (Low and Full)
- Same-level suppression to avoid redundant API calls
- Timeout + retry networking
- Replace-latest queue: only the newest intent is sent
- Optional fire-and-forget mode
- Uses POST /1/appliances/{applianceId}/light with button=on|off|on-100|...

---

## Installation

npm install -g homebridge-nature-remo-lighting

Restart Homebridge after installation.

---

## Configuration

Add accessories under the accessories section in config.json.

### Example

{
  "accessories": [
    {
      "accessory": "NatureRemoLighting",
      "name": "Light",
      "token": "YOUR_TOKEN",
      "applianceId": "YOUR_APPLIANCE_ID",
      "lowLevel": 20,
      "debounceMs": 220,
      "fastDebounceMs": 80,
      "fireAndForget": true,
      "keepAliveConnections": 4,
      "httpTimeoutMs": 4000,
      "retries": 2,
      "buttonMap": {
        "low": "on",
        "full": "on-100",
        "off": "off"
      }
    }
  ]
}

---

## Getting Your Token & Appliance ID

Generate a token in the Nature Remo portal.

Retrieve appliances:

curl -H "Authorization: Bearer YOUR_TOKEN" \
     https://api.nature.global/1/appliances | jq

Use the id of the object with "type": "LIGHT" as your applianceId.

---

## Behavior Summary

HomeKit Brightness → Bucket → Command:

0% → Off → off  
1–LOW% → Low → on  
(LOW+1)–100% → Full → on-100  

HomeKit brightness/sliders and scenes produce only one final command due to built-in coalescing.

---

## License
MIT