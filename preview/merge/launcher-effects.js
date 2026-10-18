// Local preview feedback only: the model owns inventory and occupied cells.
export function createLauncherEffects({ cells, art, isReducedMotion, getPlaybackRate }) {
  const flights = new Map();
  const animations = new Set();
  const localAnimations = new Map();
  const itemIds = new Map();
  function animate(element, frames, duration, done) {
    if (!element || isReducedMotion()) { done?.(); return null; }
    const animation = element.animate(frames, { duration, easing: 'ease-out' });
    animation.playbackRate = getPlaybackRate(); animations.add(animation);
    const finish = () => { animations.delete(animation); done?.(); };
    animation.onfinish = finish; animation.oncancel = finish;
    return animation;
  }
  function local(index, kind, element, frames, duration) {
    const key = `${index}/${kind}`;
    localAnimations.get(key)?.cancel();
    let animation;
    animation = animate(element, frames, duration, () => {
      if (localAnimations.get(key) === animation) localAnimations.delete(key);
    });
    if (animation) localAnimations.set(key, animation);
  }
  function settle(index) {
    localAnimations.get(`${index}/land`)?.cancel();
    localAnimations.delete(`${index}/land`);
    const flight = flights.get(index);
    if (!flight) return;
    flights.delete(index);
    flight.animation?.cancel(); flight.element.remove();
    cells[index].element.classList.remove('arriving');
  }
  function sync(index, itemId) {
    if (flights.has(index) && flights.get(index).itemId !== itemId) settle(index);
    if (itemIds.has(index) && itemIds.get(index) !== itemId) {
      for (const kind of ['land', 'stock', 'outlet', 'blocked']) {
        localAnimations.get(`${index}/${kind}`)?.cancel();
        localAnimations.delete(`${index}/${kind}`);
      }
    }
    itemIds.set(index, itemId);
  }
  function play(result) {
    const source = cells[result.from], target = cells[result.to];
    if (!source || !target) return;
    local(result.from, 'outlet', source.outlet, [
      { transform: 'scale(1)', opacity: .55 }, { transform: 'scale(1.45, .75)', opacity: 1, offset: .35 },
      { transform: 'scale(1)', opacity: .55 },
    ], 210);
    local(result.from, 'stock', source.level, [
      { transform: 'scale(1)', color: '#fff8e4' }, { transform: 'scale(1.18)', color: '#d8ffb5', offset: .35 },
      { transform: 'scale(1)', color: '#fff8e4' },
    ], 250);
    if (isReducedMotion()) return;
    settle(result.to);
    const origin = source.element.getBoundingClientRect(), end = target.element.getBoundingClientRect();
    const element = document.createElement('div'); element.className = 'launch-flight';
    element.setAttribute('aria-hidden', 'true');
    const image = document.createElement('img'); image.src = art({ kind: 'product', product: result.product, level: result.level });
    element.append(image);
    Object.assign(element.style, { left: `${end.left}px`, top: `${end.top}px`, width: `${end.width}px`, height: `${end.height}px` });
    document.body.append(element); target.element.classList.add('arriving');
    const dx = origin.left - end.left, dy = origin.top - end.top;
    const flight = { itemId: result.itemId, element, animation: null }; flights.set(result.to, flight);
    flight.animation = animate(element, [
      { transform: `translate(${dx}px, ${dy}px) scale(.55)`, opacity: .85 },
      { transform: `translate(${dx * .45}px, ${dy * .45 - 12}px) scale(.95)`, opacity: 1, offset: .5 },
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
    ], 240, () => {
      if (flights.get(result.to) !== flight) return;
      flights.delete(result.to); element.remove(); target.element.classList.remove('arriving');
      local(result.to, 'land', target.sprite, [
        { transform: 'scale(.94)', filter: 'brightness(1.15)' },
        { transform: 'scale(1.04)', filter: 'brightness(1.05)', offset: .45 },
        { transform: 'scale(1)', filter: 'brightness(1)' },
      ], 160);
    });
  }
  function refill(index) {
    local(index, 'stock', cells[index].level, [
      { transform: 'scale(1)', background: '#235e52' },
      { transform: 'scale(1.15)', background: '#4a8551', offset: .35 },
      { transform: 'scale(1)', background: '#235e52' },
    ], 340);
  }
  function blocked(index) {
    local(index, 'blocked', cells[index]?.outlet, [
      { transform: 'translateX(0)', opacity: .5 }, { transform: 'translateX(-2px)', opacity: 1, offset: .25 },
      { transform: 'translateX(2px)', opacity: .9, offset: .6 }, { transform: 'translateX(0)', opacity: .5 },
    ], 240);
  }
  function clear() {
    for (const index of [...flights.keys()]) settle(index);
    for (const animation of [...animations]) animation.cancel();
    localAnimations.clear(); itemIds.clear();
  }
  return { play, refill, blocked, sync, settle, clear };
}
