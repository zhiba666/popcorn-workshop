"""Reproduce a two-contact pinch in the foreground Douyin mini-game window.

Windows x64; requires Pillow for evidence capture. No system settings are changed.
Choose the HWND from a fresh window observation, activate and inspect the game,
then run, for example:
  python pinch_probe.py in --hwnd 133526 --expected-process D:\\douyin\\douyin.exe \
      --output-dir pinch-in

`in` closes the fingers (zoom out); `out` opens them (zoom in). Output contains
raw window captures, a contact sheet and measured timings. Capturing samples
adds overhead; measured duration is not phone input latency. Existing output
directories are refused so evidence cannot be silently overwritten.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
import ctypes as c
from ctypes import wintypes as w
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import time


class POINTER_INFO(c.Structure):
    _fields_ = [
        ('pointerType', w.UINT), ('pointerId', w.UINT), ('frameId', w.UINT),
        ('pointerFlags', w.UINT), ('sourceDevice', w.HANDLE), ('hwndTarget', w.HWND),
        ('ptPixelLocation', w.POINT), ('ptHimetricLocation', w.POINT),
        ('ptPixelLocationRaw', w.POINT), ('ptHimetricLocationRaw', w.POINT),
        ('dwTime', w.DWORD), ('historyCount', w.UINT), ('InputData', c.c_int32),
        ('dwKeyStates', w.DWORD), ('PerformanceCount', c.c_uint64),
        ('ButtonChangeType', c.c_int32),
    ]


class POINTER_TOUCH_INFO(c.Structure):
    _fields_ = [
        ('pointerInfo', POINTER_INFO), ('touchFlags', w.UINT), ('touchMask', w.UINT),
        ('rcContact', w.RECT), ('rcContactRaw', w.RECT),
        ('orientation', w.UINT), ('pressure', w.UINT),
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('direction', choices=['in', 'out'])
    parser.add_argument('--hwnd', type=int, required=True)
    parser.add_argument('--expected-process', required=True)
    parser.add_argument('--seconds', type=float, default=2.0)
    parser.add_argument('--small', type=float, default=.09,
                        help='Half-distance as a fraction of window width')
    parser.add_argument('--large', type=float, default=.28)
    parser.add_argument('--cx', type=float, default=210 / 406)
    parser.add_argument('--cy', type=float, default=450 / 778)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    values = [args.seconds, args.small, args.large, args.cx, args.cy]
    if not all(math.isfinite(v) for v in values):
        parser.error('All gesture values must be finite')
    if not (.5 <= args.seconds <= 6 and .02 <= args.small < args.large <= .4):
        parser.error('Use 0.5–6 seconds and 0.02 <= small < large <= 0.4')
    if not (args.large + .02 <= args.cx <= 1 - args.large - .02
            and .15 <= args.cy <= .85):
        parser.error('Gesture endpoints must stay inside the inspected game canvas')
    if args.output_dir.exists():
        parser.error('Output directory already exists; choose a new capture directory')

    from PIL import Image, ImageDraw, ImageGrab

    u = c.WinDLL('user32', use_last_error=True)
    k = c.WinDLL('kernel32', use_last_error=True)
    u.SetProcessDpiAwarenessContext.argtypes = [c.c_void_p]
    u.SetProcessDpiAwarenessContext.restype = w.BOOL
    if not u.SetProcessDpiAwarenessContext(c.c_void_p(-4)):
        raise c.WinError(c.get_last_error())
    u.GetForegroundWindow.restype = w.HWND
    u.GetWindowRect.argtypes = [w.HWND, c.POINTER(w.RECT)]
    u.GetWindowRect.restype = w.BOOL
    u.GetWindowTextW.argtypes = [w.HWND, w.LPWSTR, c.c_int]
    u.GetWindowTextW.restype = c.c_int
    u.GetWindowThreadProcessId.argtypes = [w.HWND, c.POINTER(w.DWORD)]
    u.GetWindowThreadProcessId.restype = w.DWORD
    u.WindowFromPhysicalPoint.argtypes = [w.POINT]
    u.WindowFromPhysicalPoint.restype = w.HWND
    u.GetAncestor.argtypes = [w.HWND, w.UINT]
    u.GetAncestor.restype = w.HWND
    u.InitializeTouchInjection.argtypes = [w.UINT, w.DWORD]
    u.InitializeTouchInjection.restype = w.BOOL
    u.InjectTouchInput.argtypes = [w.UINT, c.POINTER(POINTER_TOUCH_INFO)]
    u.InjectTouchInput.restype = w.BOOL
    k.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
    k.OpenProcess.restype = w.HANDLE
    k.QueryFullProcessImageNameW.argtypes = [w.HANDLE, w.DWORD, w.LPWSTR,
                                           c.POINTER(w.DWORD)]
    k.QueryFullProcessImageNameW.restype = w.BOOL
    k.CloseHandle.argtypes = [w.HANDLE]
    k.CloseHandle.restype = w.BOOL

    if c.sizeof(POINTER_INFO) != 96 or c.sizeof(POINTER_TOUCH_INFO) != 144:
        raise RuntimeError('This probe requires the Windows x64 structure layout')
    hwnd = args.hwnd
    title = c.create_unicode_buffer(256)
    u.GetWindowTextW(hwnd, title, len(title))
    if title.value != '小游戏' or u.GetForegroundWindow() != hwnd:
        raise RuntimeError('The inspected mini-game must remain the foreground window')
    pid = w.DWORD()
    if not u.GetWindowThreadProcessId(hwnd, c.byref(pid)):
        raise c.WinError(c.get_last_error())
    process = k.OpenProcess(0x1000, False, pid.value)
    if not process:
        raise c.WinError(c.get_last_error())
    try:
        process_name = c.create_unicode_buffer(32768)
        size = w.DWORD(len(process_name))
        if not k.QueryFullProcessImageNameW(process, 0, process_name, c.byref(size)):
            raise c.WinError(c.get_last_error())
    finally:
        k.CloseHandle(process)
    expected = Path(args.expected_process).resolve()
    if (expected.name.lower() != 'douyin.exe'
            or str(Path(process_name.value).resolve()).casefold() != str(expected).casefold()):
        raise RuntimeError('Target process is not the explicitly selected Douyin executable')

    bounds = w.RECT()
    if not u.GetWindowRect(hwnd, c.byref(bounds)):
        raise c.WinError(c.get_last_error())
    rect = [bounds.left, bounds.top, bounds.right, bounds.bottom]
    width, height = bounds.right - bounds.left, bounds.bottom - bounds.top
    if width <= 0 or height <= 0:
        raise RuntimeError('Target window has no capture area')
    cx, cy = bounds.left + width * args.cx, bounds.top + height * args.cy
    small, large = width * args.small, width * args.large
    initial, final = (large, small) if args.direction == 'in' else (small, large)
    contacts = (POINTER_TOUCH_INFO * 2)()
    frames, last_radius, active = 0, None, False
    captures = []
    capture_seconds = 0.0
    frame_timeline = []
    started_at = datetime.now(timezone.utc).isoformat()
    started = time.monotonic()

    def validate_target():
        if u.GetForegroundWindow() != hwnd:
            raise RuntimeError('Foreground changed; stopping the gesture')
        current_pid = w.DWORD()
        u.GetWindowThreadProcessId(hwnd, c.byref(current_pid))
        if current_pid.value != pid.value:
            raise RuntimeError('Target process changed; reobserve before retrying')
        current = w.RECT()
        if not u.GetWindowRect(hwnd, c.byref(current)):
            raise c.WinError(c.get_last_error())
        if [current.left, current.top, current.right, current.bottom] != rect:
            raise RuntimeError('Target moved or resized; reobserve before retrying')
        for sign in [-1, 1]:
            for step in range(9):
                radius = small + (large - small) * step / 8
                point = w.POINT(round(cx + sign * radius), round(cy))
                if u.GetAncestor(u.WindowFromPhysicalPoint(point), 2) != hwnd:
                    raise RuntimeError('Gesture path is covered by another window')

    def capture(label):
        nonlocal capture_seconds
        validate_target()
        before = time.monotonic()
        shot = ImageGrab.grab(bbox=tuple(rect), all_screens=True)
        offset = time.monotonic() - started
        filename = f'{len(captures):02d}-{label}.png'
        captures.append({'file': filename, 'elapsed_seconds': round(offset, 4),
                         'capture_started_seconds': round(before - started, 4),
                         'image': shot})
        capture_seconds += time.monotonic() - before

    def frame(radius, flags, safety=True):
        nonlocal frames, last_radius
        if safety:
            validate_target()
        for index, sign in enumerate([-1, 1]):
            contact = contacts[index]
            x, y = round(cx + sign * radius), round(cy)
            contact.pointerInfo.pointerType = 2
            contact.pointerInfo.pointerId = index
            contact.pointerInfo.pointerFlags = flags
            contact.pointerInfo.ptPixelLocation = w.POINT(x, y)
            contact.touchFlags = 0
            contact.touchMask = 1
            contact.rcContact = w.RECT(x - 3, y - 3, x + 3, y + 3)
        for _ in range(4):
            if u.InjectTouchInput(2, contacts):
                break
            error = c.get_last_error()
            if error != 21:
                raise c.WinError(error)
            time.sleep(.003)
        else:
            raise RuntimeError('Repeated ERROR_NOT_READY')
        last_radius = radius
        frames += 1
        frame_timeline.append({'frame': frames, 'flags': flags,
                               'elapsed_seconds': round(time.monotonic() - started, 6),
                               'distance_px': round(radius * 2), 'retries': _})

    validate_target()
    if not u.InitializeTouchInjection(2, 3):
        raise c.WinError(c.get_last_error())
    args.output_dir.mkdir(parents=True, exist_ok=False)
    capture('before')
    gesture_started = time.monotonic()
    gesture_started_at = datetime.now(timezone.utc).isoformat()
    failure, release_failure = None, None
    collector = ThreadPoolExecutor(max_workers=1)
    pending_captures = []
    try:
        frame(initial, 0x10006)
        active = True
        pending_captures.append(collector.submit(capture, 'down'))
        time.sleep(.12)
        count = max(20, round(args.seconds / .02))
        sample_frames = {round(count * fraction) for fraction in [.25, .5, .75]}
        for index in range(1, count + 1):
            progress = index / count
            ease = progress * progress * (3 - 2 * progress)
            frame(initial + (final - initial) * ease, 0x20006)
            if index in sample_frames:
                pending_captures.append(collector.submit(capture, f'move-{index:03d}'))
            time.sleep(args.seconds / count)
        frame(final, 0x20006)
        time.sleep(.08)
        frame(final, 0x40000)
        active = False
    except BaseException as error:
        failure = f'{type(error).__name__}: {error}'
    finally:
        if active and last_radius is not None:
            try:
                frame(last_radius, 0x40000, safety=False)
                active = False
            except BaseException as error:
                release_failure = f'{type(error).__name__}: {error}'
    gesture_seconds = (frame_timeline[-1]['elapsed_seconds']
                       - frame_timeline[0]['elapsed_seconds']) if frame_timeline else None
    collector.shutdown(wait=True)
    capture_errors = []
    for future in pending_captures:
        try:
            future.result()
        except BaseException as error:
            capture_errors.append(f'{type(error).__name__}: {error}')
    if failure is None:
        time.sleep(.5)
        try:
            capture('released')
        except BaseException as error:
            capture_errors.append(f'{type(error).__name__}: {error}')
    save_started = time.monotonic()
    for item in captures:
        item['image'].save(args.output_dir / item['file'])
    previews = [item['image'].resize((305, round(height * 305 / width)))
                for item in captures]
    sheet = Image.new('RGB', (305 * len(previews), previews[0].height + 28), 'white')
    draw = ImageDraw.Draw(sheet)
    for index, (item, preview) in enumerate(zip(captures, previews)):
        sheet.paste(preview, (index * 305, 28))
        draw.text((index * 305 + 6, 8),
                  f"{item['file'][:-4]}  {item['elapsed_seconds']:.2f}s", fill='black')
    sheet.save(args.output_dir / 'contact-sheet.png')
    result = {
        'captured_at_utc': started_at,
        'gesture_started_at_utc': gesture_started_at,
        'evidence_kind': 'new capture; not a recovery of the deleted earlier files',
        'recollected': True,
        'target': {'hwnd': hwnd, 'pid': pid.value, 'title': title.value,
                   'process': process_name.value, 'physical_bounds': rect},
        'direction': args.direction,
        'physical_center': [round(cx), round(cy)],
        'start_distance_px': round(initial * 2),
        'end_distance_px': round(final * 2),
        'requested_movement_seconds': args.seconds,
        'measured_down_to_release_seconds': (round(gesture_seconds, 4)
                                            if gesture_seconds is not None else None),
        'background_capture_seconds': round(capture_seconds, 4),
        'png_save_seconds': round(time.monotonic() - save_started, 4),
        'accepted_api_frames': frames,
        'api_sequence_completed': failure is None and release_failure is None,
        'failure': failure, 'release_failure': release_failure,
        'capture_errors': capture_errors,
        'frame_timeline': frame_timeline,
        'samples': [{key: value for key, value in item.items() if key != 'image'}
                    for item in captures],
        'limitations': ['Windows desktop injected touch, not a physical phone',
                        'Background screenshot capture may add scheduling overhead',
                        'Sample names describe request points; capture times are recorded',
                        'Images are encoded after the gesture; timings are measured',
                        'API acceptance alone does not prove a visible zoom response'],
    }
    (args.output_dir / 'gesture.json').write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: result[key] for key in [
        'direction', 'measured_down_to_release_seconds', 'accepted_api_frames',
        'api_sequence_completed', 'capture_errors']}, ensure_ascii=False))
    if failure is not None or release_failure is not None:
        raise RuntimeError(f'Gesture failed: {failure}; release: {release_failure}')


if __name__ == '__main__':
    main()
