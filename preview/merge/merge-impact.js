// The merge controller owns playback, cancellation and the target cell's decorations.
export function playMergeImpact({ decorate, index, x, y, size, discovery = false, impact = 60 }) {
  const cx = x + size * .5, cy = y + size * .46;
  const strength = discovery ? 1.12 : 1;
  const core = size * .38;

  decorate({
    left: `${cx - core / 2}px`, top: `${cy - core / 2}px`,
    width: `${core}px`, height: `${core}px`, borderRadius: '50%', zIndex: '4',
    background: 'radial-gradient(circle, #fffde6 0 11%, #ffe6a4dd 30%, #efb74477 50%, #efb74400 74%)',
  }, [
    { opacity: 0, transform: 'scale(.45)', offset: 0 },
    { opacity: .95, transform: `scale(${strength})`, offset: .18 },
    { opacity: .48, transform: `scale(${strength * 1.12})`, offset: .45 },
    { opacity: 0, transform: `scale(${strength * 1.2})`, offset: 1 },
  ], discovery ? 120 : 100, { index, delay: Math.max(0, impact - 12) });

  // Short bright rays mark the contact, then clear the growing item's silhouette.
  for (let ray = 0; ray < 4; ray++) {
    const angle = -63 + ray * 90;
    const width = size * (ray % 2 ? .14 : .17) * strength;
    const height = Math.max(1.1, size * .034);
    const start = size * .12, peak = size * .25, end = size * .33;
    decorate({
      left: `${cx - width / 2}px`, top: `${cy - height / 2}px`,
      width: `${width}px`, height: `${height}px`, borderRadius: '50%', zIndex: '4',
      background: 'linear-gradient(90deg, #e8ac3600, #ffe7a0 24%, #fff9d9 56%, #f1bd4f 82%, #e8ac3600)',
      transformOrigin: '50% 50%',
    }, [
      { opacity: 0, transform: `rotate(${angle}deg) translateX(${start}px) scaleX(.35)`, offset: 0 },
      { opacity: 1, transform: `rotate(${angle}deg) translateX(${peak}px) scaleX(1)`, offset: .22 },
      { opacity: .55, transform: `rotate(${angle}deg) translateX(${end * .94}px) scaleX(.65)`, offset: .55 },
      { opacity: 0, transform: `rotate(${angle}deg) translateX(${end}px) scaleX(.2)`, offset: 1 },
    ], discovery ? 130 : 110, { index, delay: Math.max(0, impact - 4) });
  }

  const ring = size * .48;
  decorate({
    left: `${cx - ring / 2}px`, top: `${cy - ring / 2}px`,
    width: `${ring}px`, height: `${ring}px`, borderRadius: '50%', zIndex: '3',
    border: '1px solid #f6d98b',
  }, [
    { opacity: 0, transform: 'scale(.72)', offset: 0 },
    { opacity: discovery ? .28 : .2, transform: 'scale(1)', offset: .2 },
    { opacity: 0, transform: 'scale(1.5)', offset: 1 },
  ], discovery ? 170 : 145, { index, delay: impact });

  const quantity = discovery ? 4 : 3;
  for (let particle = 0; particle < quantity; particle++) {
    const angle = (-145 + particle * 116) * Math.PI / 180;
    const distance = size * (particle % 2 ? .35 : .38);
    const dx = Math.cos(angle) * distance, dy = Math.sin(angle) * distance;
    const diameter = Math.max(2, Math.min(3.5, size * .075));
    const gold = particle % 2 === 0;
    decorate({
      left: `${cx - diameter / 2}px`, top: `${cy - diameter / 2}px`,
      width: `${diameter}px`, height: `${diameter}px`, zIndex: '4',
      borderRadius: gold ? '25%' : '50%',
      background: gold ? '#f3c35d' : '#fff1bd',
      border: `1px solid ${gold ? '#dca947' : '#edcf8a'}`,
    }, [
      { opacity: 0, transform: `translate(${dx * .3}px, ${dy * .3}px) scale(.65)`, offset: 0 },
      { opacity: .9, transform: `translate(${dx * .72}px, ${dy * .72 - size * .025}px) scale(1) rotate(25deg)`, offset: .22 },
      { opacity: 0, transform: `translate(${dx}px, ${dy + size * .04}px) scale(.45) rotate(70deg)`, offset: 1 },
    ], (discovery ? 165 : 145) + particle * 5, { index, delay: impact + 6 });
  }
}
