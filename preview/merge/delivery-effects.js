export function createDeliveryEffects({ cells, art, isReducedMotion, getPlaybackRate }) {
  const flights = new Map();
  function capture(result) {
    if (!result.ok || isReducedMotion()) return null;
    const destination = document.querySelector('.order-portrait').getBoundingClientRect();
    return {
      destination,
      items: result.deliveredItems.map(item => ({ item, origin: cells[item.index].element.getBoundingClientRect() })),
    };
  }
  function play(snapshot) {
    if (!snapshot || isReducedMotion()) return;
    snapshot.items.forEach(({ item, origin }, index) => {
      if (!origin.width || !origin.height) return;
      const element = document.createElement('div'); element.className = 'delivery-flight';
      element.setAttribute('aria-hidden', 'true');
      const image = document.createElement('img'); image.src = art(item); element.append(image);
      Object.assign(element.style, {
        left: `${origin.left}px`, top: `${origin.top}px`, width: `${origin.width}px`, height: `${origin.height}px`,
      });
      document.body.append(element);
      const destination = snapshot.destination;
      const horizontal = destination.left + destination.width / 2 - origin.left - origin.width / 2;
      const vertical = destination.top + destination.height / 2 - origin.top - origin.height / 2;
      const animation = element.animate([
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        { transform: `translate(${horizontal * .5}px, ${vertical * .5 - 12}px) scale(.9)`, opacity: 1, offset: .5 },
        { transform: `translate(${horizontal}px, ${vertical}px) scale(.45)`, opacity: 0 },
      ], { duration: 300, delay: index * 35, fill: 'backwards', easing: 'ease-in-out' });
      animation.playbackRate = getPlaybackRate(); flights.set(animation, element);
      const finish = () => { flights.delete(animation); element.remove(); };
      animation.onfinish = finish; animation.oncancel = finish;
    });
  }
  function clear() {
    for (const [animation, element] of [...flights]) { animation.cancel(); element.remove(); }
    flights.clear();
  }
  return { capture, play, clear };
}
