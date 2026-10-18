import { playMergeImpact } from './merge-impact.js';

// Visual feedback only: the caller owns the board state and merge timing.
export function createMergeEffects({ board, cells, getGhost, isReducedMotion, getPlaybackRate = () => 1 }) {
  let layer = null;
  const animations = new Set(), subjects = new Map(), decorations = new Set();
  const originalPoses = new Map(), cancellations = new Map();
  const contactVisuals = new Map(), decorationAnimations = new Map();
  const raisedCells = new Map();

  const subject = index => cells[index]?.piece || cells[index]?.sprite;
  const pressureLayer = element => element?.querySelector('.piece-content') || element;

  function animate(element, frames, options, finish) {
    const animation = element.animate(frames, options);
    const playbackRate = getPlaybackRate();
    animation.playbackRate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
    animations.add(animation);
    let released = false;
    const release = completed => {
      if (released) return;
      released = true;
      animations.delete(animation);
      cancellations.delete(animation);
      if (subjects.get(element) === animation) subjects.delete(element);
      finish?.(completed);
    };
    animation.onfinish = () => { release(true); animation.cancel(); };
    animation.oncancel = () => release(false);
    cancellations.set(animation, () => release(false));
    return animation;
  }

  function cancelAnimation(animation) {
    if (!animation) return;
    // Cancel callbacks are queued by the browser; settle ownership before starting a new pose.
    cancellations.get(animation)?.();
    animation.cancel();
  }

  function stopPose(element) {
    if (!element) return;
    cancelAnimation(subjects.get(element));
    if (originalPoses.has(element)) {
      Object.assign(element.style, originalPoses.get(element));
      originalPoses.delete(element);
    }
    restoreStack(element);
  }

  function restoreStack(element) {
    const raised = raisedCells.get(element);
    if (!raised) return;
    raised.cell.style.zIndex = raised.zIndex;
    raisedCells.delete(element);
  }

  function raisePiece(index, element = subject(index), zIndex = '9') {
    const cell = cells[index]?.element;
    if (!cell || !element) return;
    if (!raisedCells.has(element)) raisedCells.set(element, { cell, zIndex: cell.style.zIndex });
    cell.style.zIndex = zIndex;
  }

  function displayedPose(element) {
    return element ? getComputedStyle(element).transform : 'none';
  }

  function holdDisplayedPose(element) {
    if (!element) return;
    const original = originalPoses.get(element) || { transform: element.style.transform, opacity: element.style.opacity };
    const style = getComputedStyle(element);
    const transform = style.transform, opacity = style.opacity;
    stopPose(element);
    originalPoses.set(element, original);
    // A new grab owns the pose at this instant. Letting an old growth or return
    // animation continue underneath the press moves the item away from the hand.
    Object.assign(element.style, { transform, opacity });
  }

  function pose(element, frames, duration, hold = false, easing = 'cubic-bezier(.2,.65,.3,1)') {
    if (!element) return;
    const original = originalPoses.get(element) || { transform: element.style.transform, opacity: element.style.opacity };
    stopPose(element);
    originalPoses.set(element, original);
    const animation = animate(element, frames, {
      duration, easing, fill: 'forwards',
    }, completed => {
      restoreStack(element);
      if (completed && hold) {
        element.style.transform = frames[frames.length - 1].transform;
        element.style.opacity = frames[frames.length - 1].opacity ?? original.opacity;
      }
      else {
        Object.assign(element.style, original);
        originalPoses.delete(element);
      }
    });
    subjects.set(element, animation);
  }

  function clearContact(index) {
    const visuals = contactVisuals.get(index);
    if (!visuals) return;
    for (const element of [...visuals]) {
      cancelAnimation(decorationAnimations.get(element));
      decorations.delete(element);
      element.remove();
    }
    contactVisuals.delete(index);
  }

  function softenContact(index) {
    const visuals = contactVisuals.get(index);
    if (!visuals) return;
    for (const element of [...visuals]) {
      const animation = decorationAnimations.get(element);
      const style = getComputedStyle(element);
      const opacity = Number(style.opacity), transform = style.transform;
      if (!animation?.effect || opacity < .01) {
        cancelAnimation(animation);
        continue;
      }
      // End existing contact images in their current pose while the new item is picked up.
      animation.effect.setKeyframes([{ opacity, transform }, { opacity: 0, transform }]);
      animation.effect.updateTiming({ duration: 40, delay: 0, fill: 'both', easing: 'linear' });
      animation.currentTime = 0;
    }
  }

  function cancel(index) {
    clearContact(index);
    const piece = subject(index);
    stopPose(pressureLayer(piece));
    stopPose(piece);
  }

  function press(index) {
    const piece = subject(index), sprite = pressureLayer(piece);
    if (!sprite) return;
    if (isReducedMotion()) { clear(); return; }
    softenContact(index);
    holdDisplayedPose(piece);
    raisePiece(index, piece);
    pose(sprite, [
      { transform: displayedPose(sprite) },
      { transform: 'scale(.95, .92)' },
    ], 75, true);
  }

  function lift(index, ghostSprite) {
    const sprite = subject(index);
    if (!ghostSprite) { cancel(index); return; }
    if (isReducedMotion()) { clear(); stopPose(ghostSprite); return; }
    // The ghost shares the cell's baseline size and origin. Its position already follows
    // the pointer's movement, so the complete displayed matrices can transfer unchanged.
    const start = displayedPose(sprite), pressed = displayedPose(pressureLayer(sprite));
    cancel(index);
    pose(ghostSprite, [
      { transform: start, offset: 0 },
      { transform: 'scale(1.035)', offset: .76 },
      { transform: 'none', offset: 1 },
    ], 160);
    pose(pressureLayer(ghostSprite), [{ transform: pressed }, { transform: 'none' }], 100);
  }

  function release(index) {
    const piece = subject(index), sprite = pressureLayer(piece);
    if (!sprite) return;
    if (isReducedMotion()) { clear(); return; }
    softenContact(index);
    pose(sprite, [
      { transform: displayedPose(sprite), offset: 0 },
      { transform: 'scale(1.01)', offset: .6 },
      { transform: 'none', offset: 1 },
    ], 125);
    // Resume from the frozen outer pose as well as releasing the pressure layer.
    // In particular, tapping a growing merge result must not reveal it full-size.
    pose(piece, [
      { transform: displayedPose(piece), offset: 0 },
      { transform: 'scale(1.015, .985)', offset: .76 },
      { transform: 'none', offset: 1 },
    ], 155);
    raisePiece(index, piece);
  }

  function land(index, { fromRect, contentTransform = 'none', returning = false } = {}) {
    const sprite = subject(index);
    if (!sprite) return;
    if (isReducedMotion()) { clear(); return; }
    const previous = displayedPose(sprite);
    cancel(index);
    const target = sprite.getBoundingClientRect();
    if (!target.width || !target.height) return;
    let start = previous, distance = 0;
    if (fromRect?.width > 0 && fromRect?.height > 0) {
      const dx = fromRect.left + fromRect.width / 2 - target.left - target.width / 2;
      const dy = fromRect.top + fromRect.height / 2 - target.top - target.height / 2;
      distance = Math.hypot(dx, dy);
      const unitX = target.width / (sprite.offsetWidth || target.width);
      const unitY = target.height / (sprite.offsetHeight || target.height);
      const scaleX = fromRect.width / target.width, scaleY = fromRect.height / target.height;
      const origin = getComputedStyle(sprite).transformOrigin.split(' ').map(Number.parseFloat);
      const originX = Number.isFinite(origin[0]) ? origin[0] : sprite.offsetWidth / 2;
      const originY = Number.isFinite(origin[1]) ? origin[1] : sprite.offsetHeight / 2;
      // Match the visible bounds, including the piece's low (50% / 72%) pivot.
      // A centre-only translation jumps vertically when a small result is dropped.
      const translateX = (fromRect.left - target.left) / unitX - originX * (1 - scaleX);
      const translateY = (fromRect.top - target.top) / unitY - originY * (1 - scaleY);
      start = `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`;
    }
    pose(sprite, [
      { transform: start, offset: 0 },
      { transform: 'scale(1.025, .94)', offset: .67 },
      { transform: 'scale(.995, 1.015)', offset: .86 },
      { transform: 'none', offset: 1 },
    ], returning ? Math.min(240, 150 + distance * .22) : 150);
    if (contentTransform !== 'none') {
      pose(pressureLayer(sprite), [{ transform: contentTransform }, { transform: 'none' }], 100);
    }
    raisePiece(index, sprite);
    if (!returning) {
      const targetCell = bounds(index, board.getBoundingClientRect());
      if (targetCell) decorate({
        left: `${targetCell.x + targetCell.size * .12}px`, top: `${targetCell.y + targetCell.size * .12}px`,
        width: `${targetCell.size * .76}px`, height: `${targetCell.size * .76}px`,
        borderRadius: '44%', border: '1px solid #fff1c9',
      }, [
        { opacity: .32, transform: 'scale(.88)' },
        { opacity: 0, transform: 'scale(1.04)' },
      ], 150);
    }
  }

  function ensureLayer() {
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'merge-effects';
      layer.setAttribute('aria-hidden', 'true');
      Object.assign(layer.style, {
        position: 'absolute', inset: '0', zIndex: '8', pointerEvents: 'none',
        overflow: 'hidden', borderRadius: 'inherit',
      });
      board.append(layer);
    }
    return layer;
  }

  function decorate(styles, frames, duration, { index, delay = 0, element = document.createElement('span') } = {}) {
    Object.assign(element.style, {
      position: 'absolute', display: 'block', pointerEvents: 'none', boxSizing: 'border-box',
      ...styles,
    });
    ensureLayer().append(element);
    decorations.add(element);
    if (Number.isInteger(index)) {
      if (!contactVisuals.has(index)) contactVisuals.set(index, new Set());
      contactVisuals.get(index).add(element);
    }
    const animation = animate(element, frames, {
      duration, delay, fill: 'both', easing: 'linear',
    }, () => {
      decorations.delete(element);
      decorationAnimations.delete(element);
      const visuals = contactVisuals.get(index);
      visuals?.delete(element);
      if (visuals && !visuals.size) contactVisuals.delete(index);
      element.remove();
    });
    decorationAnimations.set(element, animation);
    return element;
  }

  function bounds(index, parent) {
    const cell = cells[index]?.element;
    if (!cell) return null;
    const rect = cell.getBoundingClientRect();
    return { x: rect.left - parent.left, y: rect.top - parent.top, size: rect.width };
  }

  function contactPiece(index, capture, parent, frames, duration) {
    if (!capture?.piece || !capture.rect?.width || !capture.rect?.height) return;
    const scaleX = board.clientWidth / parent.width, scaleY = board.clientHeight / parent.height;
    const element = document.createElement('span');
    const piece = capture.piece;
    piece.hidden = false;
    Object.assign(piece.style, {
      position: 'absolute', inset: '0', left: '0', top: '0', width: '100%', height: '100%',
      transform: 'none', opacity: '1', margin: '0',
    });
    element.append(piece);
    decorate({
      left: `${(capture.rect.left - parent.left) * scaleX}px`, top: `${(capture.rect.top - parent.top) * scaleY}px`,
      width: `${capture.rect.width * scaleX}px`, height: `${capture.rect.height * scaleY}px`, zIndex: '2',
    }, frames, duration, { index, element });
  }

  function play(result, { discovery = false, orderReady = false, contact } = {}) {
    if (result.kind !== 'merge' || !cells[result.to]) return;
    if (isReducedMotion()) { clear(); return; }
    const piece = subject(result.to);
    cancel(result.to);
    if (result.from !== result.to) cancel(result.from);
    const parent = board.getBoundingClientRect();
    const target = bounds(result.to, parent), source = bounds(result.from, parent);
    if (!target) return;
    const duration = discovery ? 275 : 240, impact = 55;
    const incoming = contact?.incoming, oldTarget = contact?.target;
    const hasContact = !!(incoming?.piece && oldTarget?.piece && incoming.rect?.width && oldTarget.rect?.width);
    const moment = impact / duration;
    // The committed result is visible from the first frame. Pressure uses its own
    // layer, so touching the growing item never reveals a hidden full-size image.
    pose(piece, [
      { transform: 'scale(.34)', opacity: 1, offset: 0 },
      { transform: 'scale(.4)', opacity: 1, offset: moment * .78 },
      { transform: 'scale(.52)', opacity: 1, offset: moment, easing: 'cubic-bezier(.15,.65,.3,1)' },
      { transform: 'scale(1.075)', opacity: 1, offset: .66, easing: 'cubic-bezier(.3,0,.65,1)' },
      { transform: 'scale(.99)', opacity: 1, offset: .85 },
      { transform: 'none', opacity: 1, offset: 1 },
    ], duration, false, 'linear');
    // Clear neighbouring sprites while keeping the two contact images above the
    // small result. Picking it up promotes it above the retiring contact layer.
    raisePiece(result.to, piece, '7');

    if (hasContact) {
      const unitX = board.clientWidth / parent.width, unitY = board.clientHeight / parent.height;
      const dx = (oldTarget.rect.left + oldTarget.rect.width / 2 - incoming.rect.left - incoming.rect.width / 2) * unitX;
      const dy = (oldTarget.rect.top + oldTarget.rect.height / 2 - incoming.rect.top - incoming.rect.height / 2) * unitY;
      const sourceDx = source ? source.x - target.x : -target.size;
      const sourceDy = source ? source.y - target.y : 0;
      const direction = Math.hypot(dx, dy) > 2 ? Math.atan2(dy, dx) : Math.atan2(-sourceDy, -sourceDx);
      const squeezeX = Math.cos(direction) * target.size * .055;
      const squeezeY = Math.sin(direction) * target.size * .055;
      contactPiece(result.to, oldTarget, parent, [
        { transform: 'none', opacity: 1, offset: 0 },
        { transform: `translate(${squeezeX}px, ${squeezeY}px) scale(.96)`, opacity: .9, offset: .48 },
        { transform: 'scale(.7)', opacity: 0, offset: 1 },
      ], impact + 5);
      contactPiece(result.to, incoming, parent, [
        { transform: 'none', opacity: 1, offset: 0, easing: 'cubic-bezier(.45,0,.8,.5)' },
        { transform: `translate(${dx * .72}px, ${dy * .72}px) scale(.94)`, opacity: 1, offset: .7 },
        { transform: `translate(${dx}px, ${dy}px) scale(.62)`, opacity: 0, offset: 1 },
      ], impact + 3);
    }

    const { x, y, size } = target;
    playMergeImpact({ decorate, index: result.to, x, y, size, discovery, impact });
  }

  function clear() {
    for (const animation of animations) cancelAnimation(animation);
    animations.clear(); subjects.clear();
    for (const element of originalPoses.keys()) stopPose(element);
    for (const element of raisedCells.keys()) restoreStack(element);
    for (const element of decorations) element.remove();
    decorations.clear();
    contactVisuals.clear(); decorationAnimations.clear();
    layer?.remove(); layer = null;
  }

  return { play, clear, press, lift, release, land, cancel };
}
