// Generated from assets/recipes/runtime-catalogs.json; do not edit.
const resolveAsset = item => ({
  ...item,
  src: new URL(item.src, import.meta.url).href,
  sourceSrc: new URL(item.sourceSrc, import.meta.url).href,
});

export const factoryDecorationAssets = [
  {
    "id": "potted-plant",
    "label": "工厂盆栽",
    "size": [
      187,
      192
    ],
    "bounds": [
      33,
      20,
      158,
      169
    ],
    "type": "png",
    "group": "decoration",
    "version": "v1",
    "src": "./potted-plant.png",
    "sourceSrc": "../../../source/factory/decoration/v1/potted-plant.png",
    "metadataSchemaVersion": 2,
    "logicalSize": [
      187,
      192
    ],
    "pixelSize": [
      187,
      192
    ],
    "sourceSize": [
      1254,
      1254
    ],
    "anchorPx": [
      93.5,
      96
    ],
    "anchorNormalized": [
      0.5,
      0.5
    ],
    "sourceCrop": [
      31,
      19,
      1218,
      1238
    ]
  },
  {
    "id": "crate-stack",
    "label": "工厂木箱堆",
    "size": [
      186,
      192
    ],
    "bounds": [
      29,
      9,
      152,
      179
    ],
    "type": "png",
    "group": "decoration",
    "version": "v1",
    "src": "./crate-stack.png",
    "sourceSrc": "../../../source/factory/decoration/v1/crate-stack.png",
    "metadataSchemaVersion": 2,
    "logicalSize": [
      186,
      192
    ],
    "pixelSize": [
      186,
      192
    ],
    "sourceSize": [
      1254,
      1254
    ],
    "anchorPx": [
      93,
      96
    ],
    "anchorNormalized": [
      0.5,
      0.5
    ],
    "sourceCrop": [
      79,
      65,
      1220,
      1240
    ]
  }
].map(resolveAsset);

export default factoryDecorationAssets;
