const root = new URL('./', import.meta.url);

export const factoryDecorationAssets = [
  { id: "potted-plant", label: "工厂盆栽", size: [187, 192], bounds: [33, 20, 158, 169], type: "png", group: "decoration", version: "v1", src: new URL('./potted-plant.png', root).href, sourceSrc: new URL('../../../source/factory/decoration/v1/potted-plant.png', root).href },
  { id: "crate-stack", label: "工厂木箱堆", size: [186, 192], bounds: [29, 9, 152, 179], type: "png", group: "decoration", version: "v1", src: new URL('./crate-stack.png', root).href, sourceSrc: new URL('../../../source/factory/decoration/v1/crate-stack.png', root).href },
];

export default factoryDecorationAssets;
