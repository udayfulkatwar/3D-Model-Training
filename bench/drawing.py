"""Render a plan.json as an architect-style raster drawing, for testing the
plan reader against known ground truth.

Deliberately includes clutter a real drawing has and the reader must ignore:
furniture touching walls, toilet floor hatching, door leaves and swing arcs,
window symbols, dimension chains with extension lines, room text, a filled
north arrow and a title.
"""

from __future__ import annotations

import math
from pathlib import Path

import cv2
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.patches import Arc, Circle, Ellipse, Polygon as MplPolygon, Rectangle  # noqa: E402
from shapely.geometry import LineString, box  # noqa: E402

from plan3d import plan2d  # noqa: E402
from plan3d.model import load_plan  # noqa: E402

PEN_M = 0.015          # hairline pen width in drawing (metres at 1:1)
MARGIN_M = 2.2
DPI = 100


def render(plan_path: str | Path, out_png: str | Path, px_per_m: float) -> dict:
    plan, errors = load_plan(plan_path)
    assert plan is not None, errors
    lay = plan2d.build_layout(plan, sorted(plan.levels)[0])
    minx, miny, maxx, maxy = lay.footprint.bounds
    x0, x1, y0, y1 = minx - MARGIN_M, maxx + MARGIN_M, miny - MARGIN_M - 0.6, maxy + MARGIN_M
    w_px, h_px = round((x1 - x0) * px_per_m), round((y1 - y0) * px_per_m)
    fig = plt.figure(figsize=(w_px / DPI, h_px / DPI), dpi=DPI)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(x0, x0 + w_px / px_per_m)
    ax.set_ylim(y0, y0 + h_px / px_per_m)
    ax.axis("off")
    pt = 72 / DPI                                     # points per pixel
    hair = max(1.0, PEN_M * px_per_m) * pt
    font = lambda metres: metres * px_per_m * pt     # noqa: E731

    # walls (poche) minus openings
    walls = lay.footprint
    for og in lay.openings.values():
        walls = walls.difference(og.rect)
    for g in getattr(walls, "geoms", [walls]):
        ax.add_patch(MplPolygon(g.exterior.coords, closed=True, fc="black", ec="none"))
        for hole in g.interiors:
            ax.add_patch(MplPolygon(hole.coords, closed=True, fc="white", ec="none"))

    def line(p, q, lw=hair, **kw):
        ax.plot([p[0], q[0]], [p[1], q[1]], color="black", lw=lw, solid_capstyle="butt", **kw)

    for og in lay.openings.values():
        wg = lay.walls[og.wall_id]
        pa, pb = wg.point_at(og.a), wg.point_at(og.b)
        n, half = wg.normal, wg.thickness / 2
        if og.kind == "window":
            for off in (-half + 0.01, 0.0, half - 0.01):
                line(pa + n * off, pb + n * off)
            for p in (pa, pb):
                line(p - n * half, p + n * half)
        elif og.kind == "arch":
            for off in (-half + 0.01, half - 0.01):
                line(pa + n * off, pb + n * off, ls=(0, (4, 4)))
        else:
            target = og.opens_into or next(s for s in og.sides if s != plan2d.EXTERIOR)
            side = 1 if og.sides[0] == target else -1
            hinge = pa + n * side * half
            width = og.b - og.a
            leaf_t = 0.035
            corners = [hinge, hinge + n * side * width, hinge + n * side * width + wg.direction * leaf_t,
                       hinge + wg.direction * leaf_t]
            ax.add_patch(MplPolygon(corners, closed=True, fc="black", ec="none"))
            start = math.degrees(math.atan2(wg.direction[1], wg.direction[0]))
            sweep = 90 * side
            ax.add_patch(Arc(hinge, 2 * width, 2 * width, theta1=min(start, start + sweep),
                             theta2=max(start, start + sweep), color="black", lw=hair))

    for rid, region in lay.room_regions.items():
        _furniture(ax, plan.rooms[rid]["use"], region, hair)
        c = region.representative_point()
        ax.text(c.x, c.y + 0.25, plan.rooms[rid]["name"].upper(), ha="center", va="center",
                fontsize=font(0.18))
        ax.text(c.x, c.y - 0.05, f"{region.area:.1f} m²", ha="center", va="center", fontsize=font(0.13))

    _dimensions(ax, lay, minx, miny, maxx, maxy, hair, font)
    ax.add_patch(MplPolygon([(maxx + 1.2, maxy + 0.9), (maxx + 0.95, maxy + 0.2), (maxx + 1.45, maxy + 0.2)],
                            closed=True, fc="black"))
    ax.text(maxx + 1.2, maxy + 1.2, "N", ha="center", fontsize=font(0.3), weight="bold")
    ax.text((minx + maxx) / 2, miny - MARGIN_M - 0.2,
            f"{plan.project['name'].upper()}  -  GROUND FLOOR PLAN  -  1:100",
            ha="center", fontsize=font(0.32), weight="bold")
    fig.savefig(out_png, dpi=DPI)
    plt.close(fig)
    return {"px_per_m": px_per_m, "overall_x_m": maxx - minx, "overall_y_m": maxy - miny}


def _furniture(ax, use, region, hair):
    bx0, by0, bx1, by1 = region.bounds
    w, h = bx1 - bx0, by1 - by0
    cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
    rect = lambda x, y, rw, rh: ax.add_patch(Rectangle((x, y), rw, rh, fill=False, lw=hair))  # noqa: E731
    if use == "bedroom" and w > 2.2 and h > 2.6:
        bw = 1.8 if w > 3.2 else 1.5
        rect(cx - bw / 2, by1 - 2.0, bw, 2.0)                    # bed against the north wall
        rect(cx - bw / 2 + 0.1, by1 - 0.45, bw / 2 - 0.15, 0.3)
        rect(cx + 0.05, by1 - 0.45, bw / 2 - 0.15, 0.3)
        rect(bx0, by0 + 0.3, 0.6, min(1.8, h - 2.5))             # wardrobe touching the west wall
    elif use == "living":
        rect(cx - 1.0, by0 + 0.3, 2.0, 0.85)
        rect(cx - 0.5, by0 + 1.5, 1.0, 0.5)
    elif use == "dining":
        rect(cx - 0.4, cy - 0.6, 0.8, 1.2)
        for dy in (-0.35, 0.35):
            for dx in (-0.6, 0.6):
                ax.add_patch(Circle((cx + dx, cy + dy), 0.18, fill=False, lw=hair))
    elif use == "kitchen":
        ax.plot([bx0, bx1 - 0.6, bx1 - 0.6], [by1 - 0.6, by1 - 0.6, by0 + 0.6], color="black", lw=hair)
        rect(bx1 - 0.55, by1 - 1.4, 0.45, 0.7)
        for k in range(2):
            ax.add_patch(Circle((bx0 + 0.5 + 0.35 * k, by1 - 0.3), 0.12, fill=False, lw=hair))
    elif use == "toilet":
        clip = region.buffer(-0.02)
        for x in np.arange(bx0, bx1, 0.3):
            seg = clip.intersection(LineString([(x, by0), (x, by1)]))
            if not seg.is_empty:
                for s in getattr(seg, "geoms", [seg]):
                    ax.plot(*s.xy, color="black", lw=hair * 0.7)
        for y in np.arange(by0, by1, 0.3):
            seg = clip.intersection(LineString([(bx0, y), (bx1, y)]))
            if not seg.is_empty:
                for s in getattr(seg, "geoms", [seg]):
                    ax.plot(*s.xy, color="black", lw=hair * 0.7)
        ax.add_patch(Ellipse((cx, by1 - 0.45), 0.38, 0.5, fill=True, fc="white", ec="black", lw=hair))


def _dimensions(ax, lay, minx, miny, maxx, maxy, hair, font):
    xs = sorted({round(w.start[0], 4) for w in lay.walls.values()
                 if abs(w.start[0] - w.end[0]) < 1e-9})
    ys = sorted({round(w.start[1], 4) for w in lay.walls.values()
                 if abs(w.start[1] - w.end[1]) < 1e-9})
    tick = 0.08
    for level, pts in ((miny - 0.8, xs), (miny - 1.4, [minx, maxx])):
        ax.plot([pts[0], pts[-1]], [level, level], color="black", lw=hair)
        for x in pts:
            ax.plot([x, x], [level - 0.15, miny - 0.25], color="black", lw=hair)
            ax.plot([x - tick, x + tick], [level - tick, level + tick], color="black", lw=hair * 2)
        for a, b in zip(pts, pts[1:], strict=False):
            ax.text((a + b) / 2, level + 0.07, f"{(b - a) * 1000:.0f}", ha="center", fontsize=font(0.12))
    for level, pts in ((minx - 0.8, ys), (minx - 1.4, [miny, maxy])):
        ax.plot([level, level], [pts[0], pts[-1]], color="black", lw=hair)
        for y in pts:
            ax.plot([level - 0.15, minx - 0.25], [y, y], color="black", lw=hair)
            ax.plot([level - tick, level + tick], [y - tick, y + tick], color="black", lw=hair * 2)
        for a, b in zip(pts, pts[1:], strict=False):
            ax.text(level - 0.07, (a + b) / 2, f"{(b - a) * 1000:.0f}", va="center", ha="right",
                    rotation=90, fontsize=font(0.12))


def degrade(src: str | Path, dst: str | Path, rotate_deg=1.5, blur=1.0, noise=12.0, jpeg=60, seed=7):
    """Simulate a phone photo / scan of a printed drawing."""
    img = cv2.imread(str(src), cv2.IMREAD_GRAYSCALE)
    h, w = img.shape
    m = cv2.getRotationMatrix2D((w / 2, h / 2), rotate_deg, 1.0)
    img = cv2.warpAffine(img, m, (w, h), flags=cv2.INTER_LINEAR, borderValue=255)
    img = cv2.GaussianBlur(img, (0, 0), blur)
    rng = np.random.default_rng(seed)
    img = np.clip(img.astype(float) + rng.normal(0, noise, img.shape), 0, 255).astype(np.uint8)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, jpeg])
    Path(dst).write_bytes(buf.tobytes())


__all__ = ["render", "degrade", "box"]
