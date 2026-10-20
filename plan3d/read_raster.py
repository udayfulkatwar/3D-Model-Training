"""Read a raster floor plan into a DRAFT plan.json for human review.

Scope (v0.1): filled (poche) walls, orthogonal layout, small skew. Nothing
measured from the image is marked CONFIRMED; only the scale dimension the
reviewer supplies is. See docs/T006_PLAN_READING.md.

Pipeline
  1. binarize; keep strokes much thicker than the drawing's hairline (walls)
  2. estimate and remove skew
  3. split walls into horizontal / vertical runs with long line openings
  4. measure each run's centre and thickness sub-pixel from grey levels
  5. group runs into wall lines; gaps inside a line are openings
  6. classify openings: window (lines across the gap), door (leaf + arc
     beside the gap, which also gives the swing side), arch (empty)
  7. snap ends onto the walls they meet, convert to metres, snap to 5 mm
  8. rooms = enclosed regions found by plan3d's own layout
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import cv2
import numpy as np

from . import plan2d
from .model import Plan
from .units import sqm_to_sqft

SNAP_M = 0.005            # drawings are dimensioned to the nearest 5 mm
MIN_WALL_M = 0.075        # thinner dark strokes are not walls (door leaves, bold text)
MAX_OPENING_M = 3.5       # a longer gap splits a line into two walls
MIN_OPENING_M = 0.35
MIN_ROOM_M2 = 0.5
DOOR_SCORE = 0.6          # leaf + arc evidence needed to call a gap a door
WINDOW_FILL = 0.7         # a row across the gap this full (after pen-width bridging) is a glazing line
DEFAULTS = {"wall_height": 3.0, "floor_thickness": 0.15, "roof_thickness": 0.15,
            "door_height": 2.1, "arch_height": 2.1, "window_sill": 0.9, "window_height": 1.2}


# ---------------------------------------------------------------- image prep

HOLLOW_MAX_WALL_M = 0.45  # a hollow wall's inside is at most this wide
HOLLOW_ELONGATION = 4.0   # and at least this many times longer than wide
HOLLOW_CONTACT = 0.5      # glazing strips and hatching run alongside each other; walls do not
HOLLOW_SOLID_M = 0.05     # ink this thick is a filled wall; outlines, even blurred, are thinner
HOLLOW_RATIO = 2.0        # hollow mode needs twice as much wall inside as solid wall ink (bench: filled
                          # drawings <= 1.29, hollow >= 3.62)
HOLLOW_SHORT_M = 1.0      # shorter wall insides must continue a found wall band

def load_gray(path: str | Path, page: int = 0, dpi: int = 200) -> np.ndarray:
    path = Path(path)
    if path.suffix.lower() == ".pdf":
        import pypdfium2 as pdfium          # optional; BSD/Apache licensed
        pdf = pdfium.PdfDocument(str(path))
        img = pdf[page].render(scale=dpi / 72, grayscale=True).to_numpy()
        return img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    img = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if img is None:
        raise FileNotFoundError(path)
    if img.ndim == 3 and img.shape[2] == 4:          # flatten transparency onto white
        alpha = img[:, :, 3:4].astype(float) / 255
        img = (img[:, :, :3] * alpha + 255 * (1 - alpha)).astype(np.uint8)
    return img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def _binarize(gray: np.ndarray) -> np.ndarray:
    _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return bw > 0


def _stroke_widths(ink: np.ndarray) -> np.ndarray:
    """Histogram of stroke widths (px) sampled along stroke centres."""
    dt = cv2.distanceTransform(ink.astype(np.uint8), cv2.DIST_L2, 3)
    ridge = (dt > 0) & (dt >= cv2.dilate(dt, np.ones((3, 3), np.uint8)))
    return np.bincount(np.round(2 * dt[ridge]).astype(int), minlength=2)


def _hairline_px(ink: np.ndarray) -> float:
    """Typical pen width: the most common stroke width."""
    h = _stroke_widths(ink)
    return float(h[1:].argmax() + 1) if h[1:].any() else 1.0


def _line_wall_split(ink: np.ndarray) -> int:
    """Widest stroke still counted as a drawn line.

    Lines and walls form two clusters of stroke widths; Otsu's method on
    log-width puts the split in the valley between them. A fixed multiple of
    the pen width fails when a thick pen meets thin walls.
    """
    h = _stroke_widths(ink)
    w = np.flatnonzero(h[1:]) + 1
    if len(w) < 2:
        return 2
    x, c = np.log(w), h[w].astype(float)
    best, split = -1.0, int(w[0])
    for i in range(1, len(w)):
        a, b = c[:i].sum(), c[i:].sum()
        between = a * b * ((x[:i] * c[:i]).sum() / a - (x[i:] * c[i:]).sum() / b) ** 2
        if between > best:
            best, split = between, int(w[i - 1])
    return split


def _rough_ppm(ink: np.ndarray, known_width_m: float | None, px_per_m: float | None) -> float:
    """Scale before any wall is found: the widest ink component is the building."""
    if px_per_m is not None:
        return px_per_m
    n, _, stats, _ = cv2.connectedComponentsWithStats(ink.astype(np.uint8), connectivity=8)
    widest = max(stats[1:, cv2.CC_STAT_WIDTH], default=1) if n > 1 else ink.shape[1]
    return float(widest) / known_width_m


def _hollow_interiors(ink: np.ndarray, ppm: float, hair: float) -> np.ndarray:
    """Mask of the insides of hollow (outline-only) walls.

    A wall's inside is a white region that is thin (up to HOLLOW_MAX_WALL_M),
    long, and does not run alongside another thin region. Window glazing
    strips and floor hatching are thin too, but come in groups that share
    long borders, so they are left alone.
    """
    sealed = cv2.dilate(ink.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0   # close pinholes in scanned lines
    white = (~sealed).astype(np.uint8)
    n, lab, box_, _ = cv2.connectedComponentsWithStats(white, connectivity=4)
    dt = cv2.distanceTransform(white, cv2.DIST_L2, 3)
    area = np.bincount(lab.ravel(), minlength=n).astype(float)
    # Widths in px. A pixel's distance-to-edge overstates the true distance by about half a pixel, and
    # the region was shrunk 1 px a side by the seal: so the sealed width is ~2 * dt_max - 1 and the
    # drawn inside ~2 * dt_max + 1. Length = sealed area / sealed width.
    dt_max = np.zeros(n)
    np.maximum.at(dt_max, lab.ravel(), dt.ravel())
    width = 2 * dt_max + 1
    length = area / np.maximum(2 * dt_max - 1, 1.0)
    thin = ((width >= MIN_WALL_M * ppm * 0.6) & (width <= HOLLOW_MAX_WALL_M * ppm)
            & (length >= HOLLOW_ELONGATION * width))
    thin[0] = False
    # pairs of thin regions running alongside each other across one drawn line (glazing strips,
    # hatching). A wall only touches such regions at their ends, so it is not paired.
    reach = int(np.ceil(hair)) + 3
    tl = np.where(thin[lab], lab, 0)
    pairs: dict[tuple[int, int], int] = {}
    for dy, dx in ((0, reach), (reach, 0)):
        a = tl[: tl.shape[0] - dy, : tl.shape[1] - dx]
        b = tl[dy:, dx:]
        both = (a > 0) & (b > 0) & (a != b)
        keys, counts = np.unique(np.minimum(a[both], b[both]) * n + np.maximum(a[both], b[both]),
                                 return_counts=True)
        for k, cnt in zip(keys.tolist(), counts.tolist()):
            pairs[divmod(k, n)] = pairs.get(divmod(k, n), 0) + cnt
    alongside = np.zeros(n, bool)
    for (i, j), cnt in pairs.items():                   # glazing strips and hatch strips pair with their
        short, long_ = sorted((length[i], length[j]))   # like; a wall beside a short hatch sliver does not
        if cnt >= HOLLOW_CONTACT * short and short >= 0.5 * long_:
            alongside[i] = alongside[j] = True
    candidate = thin & ~alongside
    # length along the middle: area over the typical width (4 x mean distance to the edge, exact for a
    # straight strip); the widest point overstates the width where walls meet
    sealed = np.maximum(4 * (np.bincount(lab.ravel(), weights=dt.ravel(), minlength=n) / np.maximum(area, 1) - 0.5),
                        1.0)
    typical = sealed + 2
    length = area / sealed
    # Long ones are walls. Short ones (pieces between openings, piers) must continue a found
    # wall band on the same rows; a strip beside a door leaf or furniture does not.
    walls = candidate & (length >= HOLLOW_SHORT_M * ppm)
    cap, reach = HOLLOW_MAX_WALL_M * ppm, int(MAX_OPENING_M * ppm)
    # anything else wall-thick (short, stubby or a pier) needs the band test
    band_like = ((typical >= MIN_WALL_M * ppm * 0.6) & (typical <= cap)
                 & (np.minimum(box_[:, cv2.CC_STAT_WIDTH], box_[:, cv2.CC_STAT_HEIGHT]) <= cap) & ~alongside)
    pending = set(np.flatnonzero(band_like & ~walls).tolist()) - {0}
    while pending:                                      # a chain of short pieces grows from the long walls
        inside = walls[lab] & (lab > 0)
        found = {i for i in pending
                 if _continues_band(inside, *box_[i, :4], reach)
                 or _continues_band(inside.T, box_[i, 1], box_[i, 0], box_[i, 3], box_[i, 2], reach)}
        if not found:
            break
        walls[list(found)] = True
        pending -= found
    return walls[lab] & (lab > 0)


def _continues_band(inside: np.ndarray, x: int, y: int, w: int, h: int, reach: int) -> bool:
    """True if, along the rows y..y+h, a wall band with the same rows (+/- 3 px)
    is found within `reach` px left or right of the box x..x+w."""
    mid = y + h // 2
    for cols in (range(x - 1, max(x - reach, 0) - 1, -1), range(x + w, min(x + w + reach, inside.shape[1]))):
        hit = next((c for c in cols if inside[mid, c]), None)
        if hit is None:
            continue
        col = inside[:, hit]
        r0, r1 = mid, mid
        while r0 > 0 and col[r0 - 1]:
            r0 -= 1
        while r1 + 1 < len(col) and col[r1 + 1]:
            r1 += 1
        if abs(r0 - y) <= 3 and abs(r1 - (y + h - 1)) <= 3:
            return True
    return False


def _fill_hollow(gray: np.ndarray, ink: np.ndarray, ppm: float, hair: float) -> tuple[np.ndarray, float] | None:
    """Paint hollow walls solid so the filled-wall pipeline can read them.
    Returns (filled grey image, outline pen width px), or None when the
    drawing has filled walls already."""
    inside = _hollow_interiors(ink, ppm, hair)
    k = _odd(max(3, int(round(HOLLOW_SOLID_M * ppm))))
    solid = cv2.morphologyEx(ink.astype(np.uint8), cv2.MORPH_OPEN, np.ones((k, k), np.uint8)) > 0
    if inside.sum() < max(HOLLOW_RATIO * solid.sum(), 0.002 * inside.size):
        return None                                 # filled walls (or too little to be walls)
    grown = cv2.dilate(inside.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    dark = float(np.percentile(gray[ink], 5)) if ink.any() else 0.0
    filled = gray.copy()
    filled[grown & (gray > dark)] = dark            # the inside and the outlines' inner anti-aliasing
    return filled, _outline_pen(gray, ink, inside, hair)


def _outline_pen(gray: np.ndarray, ink: np.ndarray, inside: np.ndarray, hair: float) -> float:
    """Width of the wall outlines, px, as the sum of darkness across them.

    The reader measures wall thickness the same way (darkness summed across
    the wall), so this is the amount to take off: blur moves darkness around
    but does not change its sum. Sampled from the inside of the walls outward.
    """
    bg = float(np.percentile(gray, 90))
    fg = float(np.percentile(gray[ink], 5)) if ink.any() else 0.0
    dark = np.clip((bg - gray.astype(np.float32)) / max(bg - fg, 1.0), 0, 1)
    h, w = gray.shape
    limit = int(3 * hair) + 6
    ys, xs = np.nonzero(inside)
    sums = []
    for i in range(0, len(ys), max(1, len(ys) // 3000)):
        y, x = ys[i], xs[i]
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            if not (0 <= y + dy < h and 0 <= x + dx < w) or inside[y + dy, x + dx]:
                continue                                # only step out across the wall's edge
            total, seen = 0.0, False
            for k in range(1, limit):
                py, px = y + dy * k, x + dx * k
                if not (0 <= py < h and 0 <= px < w) or inside[py, px]:
                    break
                d = float(dark[py, px])
                if seen and d < 0.05:
                    sums.append(total)
                    break
                seen |= d > 0.5
                total += d
    return float(np.median(sums)) if sums else hair


def _odd(n: int) -> int:
    """Morphology kernels must be odd: OpenCV anchors even kernels off-centre,
    which shifts the result by a pixel or two."""
    return n if n % 2 else n + 1


def _thick_mask(ink: np.ndarray, line_max: int) -> tuple[np.ndarray, int]:
    k = _odd(max(3, line_max + 1))
    return cv2.morphologyEx(ink.astype(np.uint8), cv2.MORPH_OPEN, np.ones((k, k), np.uint8)) > 0, k


def _skew_deg(thick: np.ndarray, max_deg: float = 5.0) -> float:
    """Rotation that best aligns walls with the image axes (projection profile).

    Walls on a straight drawing pile up into sharp row and column sums; the
    sum of squared projections peaks at the aligning angle. Local gradient
    directions do not work here: a slightly rotated edge is a pixel staircase
    whose local gradients point along the steps.
    """
    small = cv2.resize(thick.astype(np.uint8) * 255, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA)
    h, w = small.shape

    def sharpness(deg: float) -> float:
        m = cv2.getRotationMatrix2D((w / 2, h / 2), deg, 1.0)
        r = cv2.warpAffine(small, m, (w, h), flags=cv2.INTER_LINEAR, borderValue=0).astype(np.float64)
        return float((r.sum(1) ** 2).sum() + (r.sum(0) ** 2).sum())

    best = max(np.arange(-max_deg, max_deg + 1e-9, 0.25), key=sharpness)
    return float(max(np.arange(best - 0.3, best + 0.3 + 1e-9, 0.02), key=sharpness))


def _rotate(gray: np.ndarray, deg: float) -> np.ndarray:
    h, w = gray.shape
    m = cv2.getRotationMatrix2D((w / 2, h / 2), deg, 1.0)
    return cv2.warpAffine(gray, m, (w, h), flags=cv2.INTER_CUBIC, borderValue=255)


# ---------------------------------------------------------------- wall runs

@dataclass
class Piece:
    orient: str        # "h" or "v"
    c: float           # centre across the wall, px (y for h, x for v)
    t: float           # thickness, px
    a: float           # start along the wall, px edge
    b: float           # end along the wall, px edge


def _runs(col: np.ndarray) -> list[tuple[int, int]]:
    d = np.diff(np.concatenate([[0], col.astype(np.int8), [0]]))
    return list(zip(np.flatnonzero(d == 1), np.flatnonzero(d == -1) - 1, strict=True))


def _pieces(mask: np.ndarray, thick: np.ndarray, dark: np.ndarray, orient: str,
            min_len: int) -> list[Piece]:
    """Constant-band runs of one orientation, measured sub-pixel."""
    m, tk, dk = (mask, thick, dark) if orient == "h" else (mask.T, thick.T, dark.T)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), connectivity=4)
    out: list[Piece] = []
    for i in range(1, n):
        x, y, w, h, _ = stats[i]
        if w < min_len:
            continue
        sub = labels[y:y + h, x:x + w] == i
        open_segs: list[dict] = []
        done: list[dict] = []
        for j in range(w):
            nxt = []
            for r0, r1 in _runs(sub[:, j]):
                seg = next((s for s in open_segs if abs(s["r0"] - r0) <= 1 and abs(s["r1"] - r1) <= 1), None)
                if seg is None:
                    seg = {"r0": r0, "r1": r1, "j0": j, "cols": []}
                else:
                    open_segs.remove(seg)
                seg["cols"].append((j, r0, r1))
                nxt.append(seg)
            done += open_segs
            open_segs = nxt
        done += open_segs
        for seg in done:
            if len(seg["cols"]) < min_len:
                continue
            ts, cs = [], []
            for j, r0, r1 in seg["cols"]:
                col, top, bot = x + j, y + r0, y + r1
                # skip columns where the wall continues across (junctions)
                if (top - 2 >= 0 and tk[top - 2, col]) or (bot + 2 < tk.shape[0] and tk[bot + 2, col]):
                    continue
                lo, hi = max(top - 3, 0), min(bot + 4, dk.shape[0])
                prof = dk[lo:hi, col]
                s = prof.sum()
                if s > 0:
                    ts.append(s)
                    cs.append(lo + (prof * np.arange(hi - lo)).sum() / s + 0.5)
            if ts:
                t, c = float(np.median(ts)), float(np.median(cs))
            else:
                rows = np.array([(r0, r1) for _, r0, r1 in seg["cols"]])
                t = float(np.median(rows[:, 1] - rows[:, 0] + 1))
                c = y + float(np.median(rows.sum(1) + 1)) / 2
            j0, j1 = seg["cols"][0][0], seg["cols"][-1][0]
            out.append(Piece(orient, c, t, float(x + j0), float(x + j1 + 1)))
    return out


@dataclass
class Opening:
    a: float                   # px along wall (gap start, sub-pixel)
    b: float
    kind: str = "arch"
    score: float = 0.0         # door evidence or glazing-line fill
    side: int = 0              # door swing: -1 = smaller image coordinate side
    hinge_at_a: bool = True


@dataclass
class Wall:
    orient: str
    c: float
    t: float
    a: float                   # outer pixel extent along the wall
    b: float
    openings: list[Opening] = field(default_factory=list)
    start: float = 0.0         # snapped centre-line ends, px
    end: float = 0.0
    id: str = ""


def _group(pieces: list[Piece], max_gap_px: float) -> list[Wall]:
    lines: list[list[Piece]] = []
    for p in sorted(pieces, key=lambda p: p.c):
        for ln in lines:
            ref = ln[0]
            if (p.orient == ref.orient and abs(p.c - ref.c) <= max(2.0, 0.3 * ref.t)
                    and abs(p.t - ref.t) <= max(2.0, 0.3 * ref.t)):
                ln.append(p)
                break
        else:
            lines.append([p])
    walls: list[Wall] = []
    for ln in lines:
        ln.sort(key=lambda p: p.a)
        weights = np.array([p.b - p.a for p in ln])
        c = float(np.average([p.c for p in ln], weights=weights))
        t = float(np.median(np.repeat([p.t for p in ln], np.maximum(1, weights.astype(int)))))
        cur = Wall(ln[0].orient, c, t, ln[0].a, ln[0].b)
        for p in ln[1:]:
            gap = p.a - cur.b
            if gap <= 1.5:
                cur.b = max(cur.b, p.b)
            elif gap <= max_gap_px:
                cur.openings.append(Opening(cur.b, p.a))
                cur.b = max(cur.b, p.b)
            else:
                walls.append(cur)
                cur = Wall(ln[0].orient, c, t, p.a, p.b)
        walls.append(cur)
    return walls


# ---------------------------------------------------------------- openings

def _xy(w: Wall, along: float, across: float) -> tuple[float, float]:
    return (along, across) if w.orient == "h" else (across, along)


def _sample(mask: np.ndarray, pts) -> float:
    h, wd = mask.shape
    vals = [mask[int(y), int(x)] for x, y in pts if 0 <= int(x) < wd and 0 <= int(y) < h]
    return float(np.mean(vals)) if vals else 0.0


def _refine_edge(profile: np.ndarray, guess: int, falling: bool) -> float:
    """Sub-pixel position where the along-wall darkness crosses 0.5."""
    lo, hi = max(guess - 4, 0), min(guess + 4, len(profile) - 1)
    for i in range(lo, hi):
        p, q = profile[i], profile[i + 1]
        if (falling and p >= 0.5 > q) or (not falling and p < 0.5 <= q):
            return i + 0.5 + (p - 0.5) / (p - q)
    return float(guess)


def _classify(w: Wall, op: Opening, ink: np.ndarray, ink_d: np.ndarray, dark: np.ndarray,
              hair: float) -> None:
    # sub-pixel gap edges from the darkness profile along the wall centre band
    band = slice(int(w.c - w.t / 4), int(w.c + w.t / 4) + 1)
    prof = dark[band, :].mean(0) if w.orient == "h" else dark[:, band].mean(1)
    op.a = _refine_edge(prof, int(round(op.a)), falling=True)
    op.b = _refine_edge(prof, int(round(op.b)), falling=False)
    width = op.b - op.a

    r0, r1 = int(np.ceil(w.c - w.t / 2)) + 1, int(np.floor(w.c + w.t / 2)) - 1
    c0, c1 = int(np.ceil(op.a)) + 2, int(np.floor(op.b)) - 2
    if r1 > r0 and c1 > c0:
        sub = ink[r0:r1, c0:c1] if w.orient == "h" else ink[c0:c1, r0:r1].T
        # Bridge breaks up to one pen width (scan noise) but not dash gaps, which
        # are several pen widths long (an arch drawn dashed must stay an arch).
        bridge = _odd(int(round(hair)) + 1)
        sub = cv2.morphologyEx(sub.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((1, bridge), np.uint8))
        fill = float(sub.mean(1).max())
        if fill >= WINDOW_FILL:
            op.kind, op.score = "window", fill
            return

    best = (0.0, 0, True)
    for hinge_at_a in (True, False):
        e, toward = (op.a, 1) if hinge_at_a else (op.b, -1)
        for side in (-1, 1):
            face = w.c + side * w.t / 2
            leaf = [_xy(w, e + toward * 2, face + side * width * f) for f in np.linspace(0.15, 0.9, 16)]
            arc = [_xy(w, e + toward * width * np.cos(th), face + side * width * np.sin(th))
                   for th in np.radians(np.linspace(15, 75, 16))]
            score = 0.5 * _sample(ink_d, leaf) + 0.5 * _sample(ink_d, arc)
            if score > best[0]:
                best = (score, side, hinge_at_a)
    op.score = best[0]
    if best[0] >= DOOR_SCORE:
        op.kind, op.side, op.hinge_at_a = "door", best[1], best[2]


# ---------------------------------------------------------------- second pass

def _solid(thick: np.ndarray, w: Wall, lo: float, hi: float) -> np.ndarray:
    """Per position along w in [lo, hi): is the wall band filled with wall pixels?"""
    r0, r1 = int(round(w.c - w.t / 2)) + 1, int(round(w.c + w.t / 2)) - 1
    if r1 <= r0:
        r0, r1 = int(w.c), int(w.c) + 1
    n_along = thick.shape[1] if w.orient == "h" else thick.shape[0]
    lo, hi = max(int(np.floor(lo)), 0), min(int(np.ceil(hi)), n_along)
    if hi <= lo:
        return np.zeros(0, bool)
    sub = thick[r0:r1, lo:hi] if w.orient == "h" else thick[lo:hi, r0:r1].T
    return sub.mean(0) >= 0.8


def _false_runs(solid: np.ndarray, min_solid: int = 2) -> list[tuple[int, int]]:
    """Runs of empty positions, ignoring solid specks shorter than min_solid."""
    s = solid.copy()
    for a, b in _runs(s):
        if b - a + 1 < min_solid:
            s[a:b + 1] = False
    return [(a, b + 1) for a, b in _runs(~s)]


def _split_and_extend(walls: list[Wall], thick: np.ndarray, ppm: float, tol: float) -> None:
    """Find short wall nibs the long-run masks dropped.

    Inside a gap, a nib splits it into separate openings. Past a free end,
    nibs leading up to a crossing wall mean the wall continues through a
    door to that wall (a free-standing end has no such nibs).
    """
    for w in walls:
        ops = []
        for op in w.openings:
            for a, b in _false_runs(_solid(thick, w, op.a, op.b)):
                ops.append(Opening(np.floor(op.a) + a, np.floor(op.a) + b))
        w.openings = ops
    for w in walls:
        hosts = [o for o in walls if o.orient != w.orient and o.a - tol <= w.c <= o.b + tol]
        for direction in (-1, 1):
            end = w.a if direction < 0 else w.b
            if any(abs(end - o.c) <= o.t / 2 + tol for o in hosts):
                continue
            ahead = [o for o in hosts if 0 < direction * (o.c - end) <= MAX_OPENING_M * ppm + o.t]
            if not ahead:
                continue
            host = min(ahead, key=lambda o: abs(o.c - end))
            near = host.c - direction * host.t / 2
            lo, hi = sorted((end, near))
            solid = _solid(thick, w, lo, hi)
            if not any(b - a + 1 >= 2 for a, b in _runs(solid)):
                continue
            for a, b in _false_runs(solid):
                if (b - a) / ppm >= MIN_OPENING_M:
                    w.openings.append(Opening(np.floor(lo) + a, np.floor(lo) + b))
            if direction < 0:
                w.a = host.c - host.t / 2
            else:
                w.b = host.c + host.t / 2
        w.openings.sort(key=lambda o: o.a)


def _short_walls(thick, hmask, vmask, walls: list[Wall], ppm: float) -> list[Piece]:
    """Walls too short for the long-run masks, found among leftover wall pixels."""
    covered = cv2.dilate((hmask | vmask).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    rest = (thick & ~covered).astype(np.uint8)
    n, _, stats, cents = cv2.connectedComponentsWithStats(rest, connectivity=4)
    out = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        long_, short = max(w, h), min(w, h)
        if area < 0.6 * w * h or short / ppm < MIN_WALL_M or long_ < 1.2 * short:
            continue
        cx, cy = cents[i]
        inside_known = any(
            (abs(cy - k.c) <= k.t / 2 and k.a - k.t <= cx <= k.b + k.t) if k.orient == "h" else
            (abs(cx - k.c) <= k.t / 2 and k.a - k.t <= cy <= k.b + k.t) for k in walls)
        if inside_known:
            continue                      # a nib of a known wall: handled along that wall
        if w >= h:
            out.append(Piece("h", y + h / 2, float(h), float(x), float(x + w)))
        else:
            out.append(Piece("v", x + w / 2, float(w), float(y), float(y + h)))
    return out


# ---------------------------------------------------------------- assembly

def _snap_ends(walls: list[Wall], tol: float) -> None:
    for w in walls:
        w.start, w.end = w.a, w.b
        hosts = [o for o in walls if o.orient != w.orient]
        for which in ("start", "end"):
            px = getattr(w, which)
            cands = [o for o in hosts if abs(px - o.c) <= o.t / 2 + tol and o.a - tol <= w.c <= o.b + tol]
            if cands:
                setattr(w, which, min(cands, key=lambda o: abs(px - o.c)).c)


def _connected(walls: list[Wall], tol: float) -> list[Wall]:
    """Keep the largest group of walls that touch each other."""
    n = len(walls)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i, p in enumerate(walls):
        for j in range(i + 1, n):
            q = walls[j]
            if p.orient == q.orient:
                continue
            # same reach rule as end snapping: an end may stop at the other wall's face
            if (p.a - tol - q.t / 2 <= q.c <= p.b + tol + q.t / 2
                    and q.a - tol - p.t / 2 <= p.c <= q.b + tol + p.t / 2):
                parent[find(i)] = find(j)
    groups: dict[int, list[Wall]] = {}
    for i, w in enumerate(walls):
        groups.setdefault(find(i), []).append(w)
    return max(groups.values(), key=lambda g: sum(w.b - w.a for w in g)) if groups else []


@dataclass
class ReadResult:
    plan: dict
    review: list[str]
    overlay: np.ndarray
    stats: dict


def read_plan(path: str | Path, out_dir: str | Path, known_width_m: float | None = None,
              px_per_m: float | None = None, project_id: str = "DRAFT") -> ReadResult:
    if (known_width_m is None) == (px_per_m is None):
        raise ValueError("give exactly one of known_width_m or px_per_m")
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    original = load_gray(path)

    def prepare(gray):
        """Binarize; if the walls are drawn hollow, fill them so they read as filled walls."""
        ink = _binarize(gray)
        hair = _hairline_px(ink)
        hollow = _fill_hollow(gray, ink, _rough_ppm(ink, known_width_m, px_per_m), hair)
        if hollow is None:
            return gray, ink, hair, None, 0.0
        filled, pen = hollow
        return filled, _binarize(filled), hair, hollow, pen

    gray, ink, hair, hollow, pen = prepare(original)
    thick, kernel = _thick_mask(ink, _line_wall_split(ink))
    skew = _skew_deg(thick)
    if abs(skew) > 0.05:                            # straighten the original, then fill again on level bands
        gray, ink, hair, hollow, pen = prepare(_rotate(original, skew))
        thick, kernel = _thick_mask(ink, _line_wall_split(ink))

    bg = float(np.percentile(gray, 90))
    fg = float(np.median(gray[thick])) if thick.any() else 0.0
    dark = np.clip((bg - gray.astype(np.float32)) / max(bg - fg, 1.0), 0, 1)
    ink_d = cv2.dilate(ink.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0

    dt = cv2.distanceTransform(thick.astype(np.uint8), cv2.DIST_L2, 3)
    ridge = (dt > 0) & (dt >= cv2.dilate(dt, np.ones((3, 3), np.uint8)))
    t_max = float(np.percentile(2 * dt[ridge], 99)) if ridge.any() else 10.0
    run_len = _odd(int(np.ceil(1.2 * t_max)) + 2)
    hmask = cv2.morphologyEx(thick.astype(np.uint8), cv2.MORPH_OPEN, np.ones((1, run_len), np.uint8)) > 0
    vmask = cv2.morphologyEx(thick.astype(np.uint8), cv2.MORPH_OPEN, np.ones((run_len, 1), np.uint8)) > 0

    pieces = _pieces(hmask, thick, dark, "h", run_len) + _pieces(vmask, thick, dark, "v", run_len)
    # scale is unknown until walls are found, so gaps are bounded by a generous pixel limit first
    rough = _group(pieces, max_gap_px=1e9)
    rough = _connected(rough, tol=3)
    xs = [w.c - w.t / 2 for w in rough if w.orient == "v"] + [w.a for w in rough if w.orient == "h"]
    xe = [w.c + w.t / 2 for w in rough if w.orient == "v"] + [w.b for w in rough if w.orient == "h"]
    ye = [w.c + w.t / 2 for w in rough if w.orient == "h"] + [w.b for w in rough if w.orient == "v"]
    x0, x1, y1 = min(xs), max(xe), max(ye)
    # a hollow wall's outline is centred on the wall face, so the filled wall is half a pen wider each side
    x0, x1, y1 = x0 + pen / 2, x1 - pen / 2, y1 - pen / 2
    ppm = px_per_m if px_per_m is not None else (x1 - x0) / known_width_m

    pieces = [p for p in pieces if p.t / ppm >= MIN_WALL_M]
    walls = _group(pieces, max_gap_px=MAX_OPENING_M * ppm)
    extra = _short_walls(thick, hmask, vmask, walls, ppm)
    if extra:
        walls = _group(pieces + extra, max_gap_px=MAX_OPENING_M * ppm)
    walls = _connected(walls, tol=3)
    _split_and_extend(walls, thick, ppm, tol=3)
    _snap_ends(walls, tol=3)
    review: list[str] = []
    for w in walls:
        if pen:                                         # undo the outline's outer half on both faces
            w.t = max(w.t - pen, 1.0)
        kept = []
        for op in w.openings:
            _classify(w, op, ink, ink_d, dark, hair)
            width_m = (op.b - op.a) / ppm
            if width_m < MIN_OPENING_M:
                review.append(f"Ignored a {width_m * 1000:.0f} mm gap in a wall (too narrow to be an opening)")
                continue
            kept.append(op)
        w.openings = kept
        if pen:                                         # ... and on the jambs
            for op in w.openings:
                op.a, op.b = op.a - pen / 2, op.b + pen / 2

    plan, stats = _to_plan(walls, ppm, x0, y1, Path(path).name, known_width_m, project_id)
    stats.update({"hollow_walls": hollow is not None, "outline_pen_px": round(pen, 2),
                  "skew_deg": round(skew, 3), "hairline_px": hair, "kernel_px": kernel,
                  "run_len_px": run_len, "px_per_m": round(ppm, 4), "origin_px": [x0, y1]})
    review = _review(plan, stats, review)
    overlay = _overlay(gray, walls, plan, ppm, x0, y1)
    (out_dir / "plan.json").write_text(json.dumps(plan, indent=1) + "\n")
    (out_dir / "review.md").write_text("\n".join(review) + "\n")
    cv2.imwrite(str(out_dir / "overlay.png"), overlay)
    return ReadResult(plan, review, overlay, stats)


def _snap(v: float) -> float:
    return round(round(v / SNAP_M) * SNAP_M, 4)


def _to_plan(walls, ppm, x0, y1, source_name, known_width_m, project_id):
    X = lambda px: _snap((px - x0) / ppm)        # noqa: E731
    Y = lambda px: _snap((y1 - px) / ppm)        # noqa: E731
    thick_types: dict[float, str] = {}
    for w in sorted(walls, key=lambda w: -w.t):
        thick_types.setdefault(_snap(w.t / ppm), f"WT{round(_snap(w.t / ppm) * 1000)}")

    hs = sorted([w for w in walls if w.orient == "h"], key=lambda w: (w.c, w.a))
    vs = sorted([w for w in walls if w.orient == "v"], key=lambda w: (w.c, w.a))
    raw_walls, raw_ops = [], []
    n_op = 0
    for k, w in enumerate(hs + vs, start=1):
        w.id = f"W{k:02d}"
        if w.orient == "h":
            start, end = (X(w.start), Y(w.c)), (X(w.end), Y(w.c))
        else:                                    # start at the south (larger image y) end
            start, end = (X(w.c), Y(w.end)), (X(w.c), Y(w.start))
        wtype = thick_types[_snap(w.t / ppm)]
        raw_walls.append({"id": w.id, "level": "L00", "type": wtype, "start": list(start),
                          "end": list(end), "prov": ["D-040", f"D-T{wtype[2:]}"]})
        length = abs(end[0] - start[0]) + abs(end[1] - start[1])
        for op in w.openings:
            n_op += 1
            if w.orient == "h":
                ca, cb = (op.a - w.start) / ppm, (op.b - w.start) / ppm
            else:
                ca, cb = (w.end - op.b) / ppm, (w.end - op.a) / ppm
            width = _snap(cb - ca)
            center = _snap((ca + cb) / 2)
            center = min(max(center, width / 2), length - width / 2)
            kind = op.kind
            height = DEFAULTS["door_height"] if kind == "door" else (
                DEFAULTS["arch_height"] if kind == "arch" else DEFAULTS["window_height"])
            sill = DEFAULTS["window_sill"] if kind == "window" else 0.0
            raw_ops.append({"id": f"O{n_op:02d}", "wall": w.id, "kind": kind, "center": center,
                            "width": width, "height": height, "sill": sill,
                            "prov": ["D-050", {"door": "D-030", "arch": "D-033", "window": "D-032"}[kind]]
                            + (["D-031"] if kind == "window" else ["D-034"]),
                            "_side": op.side, "_score": round(op.score, 3)})

    confirmed_scale = known_width_m is not None
    dims = [
        {"id": "D-001", "label": "Overall external length, east-west",
         "value": _snap(known_width_m) if confirmed_scale else 0.0,
         "status": "CONFIRMED" if confirmed_scale else "INFERRED", "source": "S-01",
         "check": {"kind": "overall", "level": "L00", "axis": "x"},
         **({"note": "Read by the reviewer from the drawing; sets the scale"} if confirmed_scale else
            {"note": "From the given pixel scale"})},
        {"id": "D-002", "label": "Overall external width, north-south", "value": 0.0, "status": "INFERRED",
         "source": "S-01", "check": {"kind": "overall", "level": "L00", "axis": "y"},
         "note": "Measured from the image at the reviewer's scale; confirm against the drawing"},
        {"id": "D-003", "label": "Finished floor level (datum)", "value": 0.0, "status": "INFERRED",
         "source": "S-01", "check": {"kind": "param", "targets": ["levels.L00.elevation"]},
         "note": "Datum convention: z = 0 at finished floor"},
        {"id": "D-020", "label": "Floor to ceiling height", "value": DEFAULTS["wall_height"], "status": "INFERRED",
         "source": "S-01", "check": {"kind": "param", "targets": ["levels.L00.wall_height"]},
         "note": "Not shown on a plan; default, confirm from section"},
        {"id": "D-021", "label": "Floor build-up below FFL", "value": DEFAULTS["floor_thickness"],
         "status": "INFERRED", "source": "S-01",
         "check": {"kind": "param", "targets": ["levels.L00.floor_thickness"]}, "note": "Visual default"},
        {"id": "D-022", "label": "Roof slab thickness", "value": DEFAULTS["roof_thickness"], "status": "INFERRED",
         "source": "S-01", "check": {"kind": "param", "targets": ["levels.L00.roof_thickness"]},
         "note": "Visual default"},
        {"id": "D-040", "label": "Wall centre-line positions: pixel size", "value": _snap(1 / ppm) or 0.001,
         "status": "INFERRED", "source": "S-01", "check": {"kind": "none"},
         "note": f"Measured from the image at {ppm:.2f} px/m and snapped to 5 mm; confirm against dimensions"},
        {"id": "D-050", "label": "Opening positions and widths: pixel size", "value": _snap(1 / ppm) or 0.001,
         "status": "INFERRED", "source": "S-01", "check": {"kind": "none"},
         "note": "Measured from the image and snapped to 5 mm; confirm against the opening schedule"},
    ]
    for kind, did, field_, val, label in (
            ("door", "D-030", "height", DEFAULTS["door_height"], "Door height"),
            ("window", "D-032", "height", DEFAULTS["window_height"], "Window height"),
            ("window", "D-031", "sill", DEFAULTS["window_sill"], "Window sill"),
            ("arch", "D-033", "height", DEFAULTS["arch_height"], "Arch height")):
        targets = [f"openings.{o['id']}.{field_}" for o in raw_ops if o["kind"] == kind]
        if targets:
            dims.append({"id": did, "label": label, "value": val, "status": "INFERRED", "source": "S-01",
                         "check": {"kind": "param", "targets": targets},
                         "note": "Not shown on a plan; default, confirm from schedule or elevation"})
    flush = [f"openings.{o['id']}.sill" for o in raw_ops if o["kind"] != "window"]
    if flush:
        dims.append({"id": "D-034", "label": "Door and arch sill (flush)", "value": 0.0, "status": "INFERRED",
                     "source": "S-01", "check": {"kind": "param", "targets": flush},
                     "note": "Assumed flush threshold"})
    for thk, tid in thick_types.items():
        dims.append({"id": f"D-T{tid[2:]}", "label": f"Wall thickness type {tid}", "value": thk,
                     "status": "INFERRED", "source": "S-01",
                     "check": {"kind": "param", "targets": [f"wall_types.{tid}.thickness"]},
                     "note": "Measured from the image (sub-pixel) and snapped to 5 mm"})
    dims.append({"id": "D-060", "label": "Rooms: enclosed regions found from walls", "value": 0.0,
                 "status": "INFERRED", "source": "S-01", "check": {"kind": "none"},
                 "note": "Room names and uses were not read (no text reading); confirm"})
    dims.append({"id": "D-090", "label": "Room names and uses", "value": None, "status": "OPEN",
                 "source": "S-01", "check": {"kind": "none"}, "note": "Not read from the drawing"})

    plan = {
        "schema_version": "0.1",
        "project": {"id": project_id, "name": f"Draft read from {source_name}", "nature": "draft from plan reader",
                    "owner": "to confirm", "permission": "to confirm before any use",
                    "units": "m", "datum": "Origin at the outer south-west corner of the walls; z = 0 at FFL",
                    "notes": "Generated by plan3d.read_raster. Every measured value is INFERRED until reviewed."},
        "tolerances": {"length": max(0.005, _snap(1.5 / ppm)), "area_rel": 0.02},
        "sources": [{"id": "S-01", "title": source_name, "revision": "as received",
                     "date": date.today().isoformat(), "kind": "plan"}],
        "dimensions": dims,
        "levels": [{"id": "L00", "name": "Ground floor", "elevation": 0.0, "wall_height": DEFAULTS["wall_height"],
                    "floor_thickness": DEFAULTS["floor_thickness"], "roof_thickness": DEFAULTS["roof_thickness"],
                    "prov": ["D-003", "D-020", "D-021", "D-022"]}],
        "wall_types": [{"id": tid, "thickness": thk, "prov": [f"D-T{tid[2:]}"]} for thk, tid in thick_types.items()],
        "walls": raw_walls,
        "openings": raw_ops,
        "rooms": [],
    }
    _add_rooms(plan)
    stats = {"walls": len(raw_walls), "openings": len(raw_ops), "rooms": len(plan["rooms"]),
             "wall_types": {tid: thk for thk, tid in thick_types.items()}}
    return plan, stats


def _add_rooms(plan: dict) -> None:
    """Rooms from enclosed regions; door swing resolved to the room it opens into."""
    side_info = {o["id"]: o.pop("_side") for o in plan["openings"]}
    for o in plan["openings"]:
        o.pop("_score")
    lay = plan2d.build_layout(Plan(plan), "L00")
    minx, miny, maxx, maxy = lay.footprint.bounds
    dims = {d["id"]: d for d in plan["dimensions"]}
    dims["D-002"]["value"] = _snap(maxy - miny)
    if dims["D-001"]["status"] == "INFERRED":
        dims["D-001"]["value"] = _snap(maxx - minx)
    regions = sorted((r for r in lay.regions if r.area >= MIN_ROOM_M2),
                     key=lambda r: (-round(r.representative_point().y, 1), r.representative_point().x))
    for i, region in enumerate(regions, start=1):
        p = region.representative_point()
        plan["rooms"].append({"id": f"R{i:02d}", "name": f"Room {i}", "level": "L00", "use": "other",
                              "seed": [round(p.x, 3), round(p.y, 3)], "prov": ["D-060"]})
    lay = plan2d.build_layout(Plan(plan), "L00")
    for o in plan["openings"]:
        if o["kind"] != "door" or not side_info[o["id"]]:
            continue
        og, wg = lay.openings[o["id"]], lay.walls[o["wall"]]
        # image side -1 (up / left) is the wall's +normal side in plan coordinates
        sgn = -side_info[o["id"]]
        room = lay.region_id_at(og.center + sgn * wg.normal * (wg.thickness / 2 + 0.3))
        if room in lay.room_regions:
            o["opens_into"] = room


def _review(plan: dict, stats: dict, notes: list[str]) -> list[str]:
    lines = [f"# Review sheet: {plan['project']['name']}", "",
             "Draft produced by the plan reader. **Nothing here is confirmed.** Check every line against",
             "the drawing, correct `plan.json`, then build with `python -m plan3d build`.", "",
             "## Reading", "",
             f"- Scale: {stats['px_per_m']} px/m; skew corrected: {stats['skew_deg']}°",
             f"- Found {stats['walls']} walls, {stats['openings']} openings, {stats['rooms']} rooms",
             "- Wall thickness types: " + ", ".join(f"{k} = {v * 1000:.0f} mm" for k, v in stats["wall_types"].items()),
             "", "## Openings", "", "| ID | Wall | Kind | Width (mm) | Opens into |", "|---|---|---|---|---|"]
    for o in plan["openings"]:
        lines.append(f"| {o['id']} | {o['wall']} | {o['kind']} | {o['width'] * 1000:.0f} | "
                     f"{o.get('opens_into', '-')} |")
    lines += ["", "## Rooms (names and uses not read: fill in)", "", "| ID | Area m² | Area sq ft |", "|---|---|---|"]
    lay = plan2d.build_layout(Plan(plan), "L00")
    for r in plan["rooms"]:
        a = lay.room_regions.get(r["id"])
        if a is not None:
            lines.append(f"| {r['id']} | {a.area:.2f} | {sqm_to_sqft(a.area):.0f} |")
    lines += ["", "## Always confirm", "",
              "- Window sills and heights, door and arch heights, ceiling height (defaults; not on a plan)",
              "- Room names and uses", "- Any opening the overlay shows in the wrong place or of the wrong kind"]
    if notes:
        lines += ["", "## Reader notes", ""] + [f"- {n}" for n in notes]
    return lines


def _overlay(gray, walls, plan, ppm, x0, y1) -> np.ndarray:
    img = cv2.cvtColor((255 - (255 - gray) * 0.35).astype(np.uint8), cv2.COLOR_GRAY2BGR)
    colours = {"door": (40, 160, 40), "window": (200, 120, 20), "arch": (0, 140, 255)}
    by_id = {w.id: w for w in walls}
    for w in walls:
        p, q = (_xy(w, w.start, w.c), _xy(w, w.end, w.c))
        cv2.line(img, tuple(map(int, p)), tuple(map(int, q)), (30, 30, 220), 2)
        mid = _xy(w, (w.start + w.end) / 2, w.c - w.t)
        cv2.putText(img, w.id, tuple(map(int, mid)), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (30, 30, 220), 1)
    for o in plan["openings"]:
        w = by_id[o["wall"]]
        along = w.start + o["center"] * ppm if w.orient == "h" else w.end - o["center"] * ppm
        cx, cy = map(int, _xy(w, along, w.c))
        cv2.circle(img, (cx, cy), int(o["width"] * ppm / 2), colours[o["kind"]], 2)
        cv2.putText(img, f"{o['id']} {o['kind'][0].upper()}", (cx + 4, cy - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.4,
                    colours[o["kind"]], 1)
    for r in plan["rooms"]:
        cx, cy = int(x0 + r["seed"][0] * ppm), int(y1 - r["seed"][1] * ppm)
        cv2.putText(img, r["id"], (cx - 12, cy), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (160, 40, 160), 2)
    return img
