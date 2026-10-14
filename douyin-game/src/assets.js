'use strict';

const manifest = require('./assets-manifest');

class Assets {
  constructor(platform) {
    this.platform = platform;
    this.images = Object.create(null);
    this.loaded = 0;
    this.total = Object.keys(manifest).length;
  }
  get(id) { return this.images[id] || null; }
  meta(id) { return manifest[id] || null; }
  async load(onProgress) {
    const entries = Object.entries(manifest);
    // Keep concurrent image decoding bounded on low-memory phones.
    let cursor = 0;
    const worker = async () => {
      while (cursor < entries.length) {
        const [id, metadata] = entries[cursor++];
        const image = this.platform.createImage();
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = () => reject(new Error('图片加载失败：' + id));
          image.src = metadata.path;
        });
        this.images[id] = image;
        this.loaded++;
        if (onProgress) onProgress(this.loaded / this.total);
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
  }
}

module.exports = { Assets };
