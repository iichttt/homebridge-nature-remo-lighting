# Homebridge Plugin for Nature Remo Light Devices
## 何のプラグイン？
NatureRemoに登録された照明機器を操作するためのHomebridge用プラグインです。全灯、常夜灯がある照明に対応し、full設定がtrueの場合は明るさ81%以上で全灯、night設定がtrueの場合は明るさ19%以下で常夜灯になります。また、full設定がtrueの場合、単に照明をONにした場合は全灯になります。

## 使い方
npmでインストールします。パッケージ名はhomebridge-nature-remo-lights-extです。

## configの書き方
`accessories` に書き加えます。下記説明に注意しながら記入してください。

複数のデバイスがある場合にはそのまま複数登録してください。

- `accessory` は `NatureRemoLightDeviceExt` で固定です。
- `accessToken` は [公式サイト](https://home.nature.global/)から発行してください。
- `id` は下記のID取得例に従って取得してください。
- `name` は任意に設定可能です。
- 全灯に対応させる場合は`full` にtrueを設定してください。
- 常夜灯に対応させる場合は`night` にtrueを設定してください。


```json
"accessories": [
  {
    "accessory": "NatureRemoLightDeviceExt",
    "accessToken": "SECRET_TOKEN",
    "id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    "name": "リビングの照明"
  },
  {
      "accessory": "NatureRemoLightDevice",
      "accessToken": "SECRET_TOKEN",
      "id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      "name": "全灯と常夜灯のある照明",
      "full": true,
      "night": true
  },
]
```

## ID取得例
curlコマンドでの例です。 `SECRET_TOKEN` の箇所は各自置き換えてください。

このAPIを叩くと登録されているデバイスの一覧をJSONのリスト形式で取得できます。そのトップ階層にある`id`キーがconfigに記入する`id`となります。

```bash
$ curl -X GET "https://api.nature.global/1/appliances" -H "Authorization: Bearer SECRET_TOKEN"
```

## ライセンス
MIT
