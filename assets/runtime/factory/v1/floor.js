// Generated from assets/recipes/runtime-catalogs.json; do not edit.
const floor = {
  "src": "./floor.png",
  "size": [
    768,
    512
  ],
  "originalSource": "../../../source/factory/environment/v1/floor.png",
  "source": "assets/source/factory/environment/v1/floor.png",
  "metadataSchemaVersion": 2,
  "logicalSize": [
    768,
    512
  ],
  "pixelSize": [
    768,
    512
  ],
  "sourceSize": [
    1536,
    1024
  ],
  "anchorPx": [
    384,
    256
  ],
  "anchorNormalized": [
    0.5,
    0.5
  ]
};

export const runtimeFactoryFloor = {
  ...floor,
  src: new URL(floor.src, import.meta.url).href,
  originalSource: new URL(floor.originalSource, import.meta.url).href,
};

export default runtimeFactoryFloor;
