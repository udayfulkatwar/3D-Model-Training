// Furniture models built from primitives in each item's local frame (origin on the floor at the item
// centre, front facing +Z). Dimensions come from the furnishing plan, so collision matches visuals.
import type { FurnItem } from '../world/furniture';
import type { GeoBuilder } from './geo';
import type { MatKey } from './materials';

const BOOKS: MatKey[] = ['bookA', 'bookB', 'bookC', 'bookD', 'paper'];

function legsMetal(b: GeoBuilder, w: number, d: number, h: number, inset = 0.06, t = 0.045, k: MatKey = 'blackMetal') {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(k, sx * (w / 2 - inset), h / 2, sz * (d / 2 - inset), t, h, t);
}

function bookshelfContents(b: GeoBuilder, w: number, d: number, shelves: number[], variant: number) {
  let seed = variant * 31 + 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (const y of shelves) {
    let x = -w / 2 + 0.06;
    while (x < w / 2 - 0.1) {
      const bw = 0.025 + rnd() * 0.035;
      const bh = 0.2 + rnd() * 0.1;
      if (rnd() < 0.12) { x += 0.12; continue; }
      b.box(BOOKS[Math.floor(rnd() * BOOKS.length)], x + bw / 2, y + bh / 2, 0, bw, bh, d * 0.7);
      x += bw + 0.004;
    }
  }
}

/** Plant: pot + soil + clustered foliage. */
function plant(b: GeoBuilder, tall: boolean, variant: number) {
  const pr = tall ? 0.28 : 0.22;
  const ph = tall ? 0.55 : 0.42;
  b.cyl('pot', 0, ph / 2, 0, pr, pr * 0.82, ph, 16);
  b.cyl('soil', 0, ph - 0.01, 0, pr * 0.92, pr * 0.92, 0.02, 12);
  if (tall) {
    b.cyl('walnut', 0, ph + 0.5, 0, 0.025, 0.03, 1.0, 6);
    const clusters = [[0, 1.45, 0, 0.32], [0.16, 1.2, 0.08, 0.26], [-0.14, 1.28, -0.1, 0.27], [0.05, 1.66, -0.05, 0.24], [-0.08, 1.05, 0.12, 0.22]];
    for (const [x, y, z, r] of clusters) b.sphere('leaf', x, y, z, r, 1, 0.85 + (variant % 3) * 0.05, 1, 1);
  } else {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + variant;
      b.sphere('leaf', Math.cos(a) * 0.12, ph + 0.28 + (i % 2) * 0.12, Math.sin(a) * 0.12, 0.17, 1, 1.25, 1, 1);
    }
    b.sphere('leaf', 0, ph + 0.48, 0, 0.18, 1, 1.3, 1, 1);
  }
}

export function buildStaticProp(b: GeoBuilder, f: FurnItem) {
  const { w, d, h } = f;
  const v = f.variant ?? 0;
  switch (f.type) {
    case 'desk': {
      const top: MatKey = v === 1 ? 'deskTopDark' : 'deskTop';
      b.box(top, 0, h - 0.0125, 0, w, 0.025, d);
      b.box('aluminium', 0, h - 0.035, 0, w - 0.04, 0.02, d - 0.04);
      for (const sx of [-1, 1]) {
        b.box('blackMetal', sx * (w / 2 - 0.08), (h - 0.04) / 2, 0, 0.05, h - 0.04, 0.05);
        b.box('blackMetal', sx * (w / 2 - 0.08), 0.02, 0, 0.06, 0.04, d - 0.1);
        b.box('blackMetal', sx * (w / 2 - 0.08), h - 0.06, 0, 0.06, 0.04, d - 0.1);
      }
      b.box('blackMetal', 0, h - 0.18, -d / 2 + 0.12, w - 0.2, 0.08, 0.12); // cable tray
      b.box('plasticDark', 0, h - 0.33, -d / 2 + 0.02, w - 0.22, 0.3, 0.012); // modesty panel
      if (v !== 1) b.box('acoustic', 0, h + 0.2, -d / 2 + 0.015, w - 0.02, 0.4, 0.03); // desk screen
      // pedestal
      b.box('laminateWhite', w / 2 - 0.36, 0.3, -0.05, 0.4, 0.58, d - 0.2);
      for (let i = 0; i < 3; i++) b.box('aluminium', w / 2 - 0.36, 0.12 + i * 0.19, d / 2 - 0.149, 0.12, 0.012, 0.01);
      break;
    }
    case 'deskExec': {
      b.box('deskTopDark', 0, h - 0.02, 0, w, 0.04, d);
      for (const sx of [-1, 1]) b.box('deskTopDark', sx * (w / 2 - 0.02), (h - 0.04) / 2, 0, 0.04, h - 0.04, d);
      b.box('deskTopDark', 0, h - 0.3, -d / 2 + 0.03, w - 0.08, 0.5, 0.025);
      b.box('gold', 0, h - 0.045, d / 2 - 0.005, w - 0.06, 0.01, 0.006);
      b.box('walnut', w / 2 - 0.35, 0.33, -0.1, 0.5, 0.62, d - 0.3);
      break;
    }
    case 'receptionDesk': {
      // visitor side is local -Z; receptionist works on the +Z side
      b.box('walnut', 0, 0.54, -d / 2 + 0.06, w, 1.08, 0.12);
      b.box('quartz', 0, 1.09, -d / 2 + 0.12, w + 0.06, 0.03, 0.3);
      b.box('gold', 0, 0.85, -d / 2 - 0.002, w - 0.1, 0.03, 0.006);
      b.box('gold', 0, 0.12, -d / 2 - 0.002, w - 0.1, 0.012, 0.006);
      b.box('quartz', 0, 0.76, 0.1, w - 0.1, 0.03, d - 0.25);
      for (const sx of [-1, 1]) b.box('walnut', sx * (w / 2 - 0.03), 0.54, 0.05, 0.06, 1.08, d - 0.1);
      b.box('walnut', w / 2 - 0.45, 0.36, 0.15, 0.5, 0.7, d - 0.4);
      b.box('lightStrip', 0, 0.02, -d / 2 - 0.02, w - 0.2, 0.01, 0.02);
      break;
    }
    case 'sofa': {
      const fabric: MatKey = v === 1 ? 'sofaAlt' : 'sofa';
      b.box('blackMetal', 0, 0.06, 0, w - 0.1, 0.06, d - 0.1);
      b.box(fabric, 0, 0.26, 0.02, w - 0.2, 0.22, d - 0.08);
      const n = Math.max(2, Math.round((w - 0.2) / 0.7));
      const cw = (w - 0.24) / n;
      for (let i = 0; i < n; i++) b.box(fabric, -w / 2 + 0.12 + cw * (i + 0.5), 0.42, 0.06, cw - 0.02, 0.1, d - 0.25);
      b.box(fabric, 0, 0.6, -d / 2 + 0.11, w - 0.2, 0.42, 0.2);
      for (const sx of [-1, 1]) b.box(fabric, sx * (w / 2 - 0.09), 0.42, 0, 0.18, 0.46, d);
      b.box('cushionGold', -w / 2 + 0.4, 0.6, -d / 2 + 0.3, 0.38, 0.32, 0.1, 0.15);
      break;
    }
    case 'coffeeTable': {
      b.box('walnut', 0, h - 0.02, 0, w, 0.04, d);
      b.box('blackMetal', 0, 0.12, 0, w - 0.1, 0.02, d - 0.1);
      legsMetal(b, w, d, h - 0.04, 0.05, 0.03);
      break;
    }
    case 'tableRound': {
      b.cyl('oak', 0, h - 0.02, 0, w / 2, w / 2, 0.04, 28);
      b.cyl('blackMetal', 0, (h - 0.04) / 2, 0, 0.04, 0.05, h - 0.04, 10);
      b.cyl('blackMetal', 0, 0.015, 0, w * 0.3, w * 0.3, 0.03, 18);
      break;
    }
    case 'tableHigh': {
      b.cyl('quartz', 0, h - 0.02, 0, w / 2, w / 2, 0.04, 24);
      b.cyl('blackMetal', 0, (h - 0.04) / 2, 0, 0.035, 0.035, h - 0.04, 10);
      b.cyl('blackMetal', 0, 0.015, 0, 0.25, 0.25, 0.03, 18);
      break;
    }
    case 'tableRect': {
      const top: MatKey = v === 1 ? 'walnut' : v === 2 ? 'oak' : 'laminateWhite';
      b.box(top, 0, h - 0.02, 0, w, 0.04, d);
      if (v === 1) {
        b.box('gold', 0, h - 0.042, 0, w - 0.4, 0.004, 0.04);
        const n = w > 3.2 ? 3 : 2;
        for (let i = 0; i < n; i++) {
          const x = (i - (n - 1) / 2) * (w - 1.0) / Math.max(1, n - 1);
          b.box('blackMetal', x, (h - 0.04) / 2, 0, 0.08, h - 0.04, Math.min(0.5, d - 0.4));
          b.box('blackMetal', x, 0.02, 0, 0.25, 0.04, d - 0.3);
        }
        if (w > 3) b.box('aluminium', 0, h - 0.002, 0, 0.3, 0.004, 0.12); // cable port
      } else {
        legsMetal(b, w, d, h - 0.04, 0.05, 0.04);
      }
      break;
    }
    case 'counter': {
      if (v === 3) {
        b.box('oak', 0, h - 0.02, 0, w, 0.04, d);
        for (let x = -w / 2 + 0.3; x <= w / 2 - 0.2; x += 1.6) b.box('blackMetal', x, (h - 0.04) / 2, 0, 0.05, h - 0.04, 0.05);
        break;
      }
      const top: MatKey = 'quartz';
      b.box(v === 2 ? 'counterFront' : 'walnut', 0, (h - 0.03) / 2, 0, w, h - 0.03, d);
      b.box(top, 0, h - 0.015, 0, w + 0.03, 0.03, d + 0.03);
      b.box('rubber', 0, 0.04, d / 2 + 0.001, w - 0.02, 0.08, 0.004);
      if (v === 2) {
        b.box('gold', 0, h - 0.06, d / 2 + 0.006, w, 0.02, 0.004);
        b.box('quartz', 0, h + 0.18, -d / 2 + 0.12, w - 0.4, 0.03, 0.24); // raised pick-up shelf on the customer side
        b.box('glass', 0, h + 0.09, -d / 2 + 0.12, w - 0.4, 0.16, 0.02);
        // pastry display
        b.box('glass', -w / 2 + 0.8, h + 0.18, 0, 1.1, 0.36, d * 0.6);
        for (let i = 0; i < 6; i++) b.sphere('oak', -w / 2 + 0.45 + i * 0.14, h + 0.06, 0, 0.05, 1, 0.5, 1, 0);
      }
      if (v === 1) {
        // back counter: upper open shelving with cups, and a sink
        for (const y of [1.6, 1.95]) b.box('walnut', 0, y, -d / 2 + 0.15, w - 0.2, 0.03, 0.28);
        for (let i = 0; i < Math.floor(w / 0.3); i++) b.cyl('ceramic', -w / 2 + 0.25 + i * 0.3, 1.66, -d / 2 + 0.15, 0.045, 0.04, 0.09, 10);
        b.box('steel', w / 2 - 0.6, h + 0.001, 0, 0.5, 0.004, 0.38);
        b.cyl('steel', w / 2 - 0.6, h + 0.15, -d / 2 + 0.08, 0.012, 0.012, 0.3, 8);
      }
      break;
    }
    case 'cabinet': {
      b.box('oak', 0, h / 2, 0, w, h, d);
      const n = Math.max(2, Math.round(w / 0.6));
      for (let i = 1; i < n; i++) b.box('plasticDark', -w / 2 + (w / n) * i, h / 2, d / 2 + 0.001, 0.004, h - 0.04, 0.003);
      for (let i = 0; i < n; i++) b.box('aluminium', -w / 2 + (w / n) * (i + 0.5), h - 0.12, d / 2 + 0.012, 0.1, 0.012, 0.02);
      b.box('quartz', 0, h + 0.01, 0, w + 0.02, 0.02, d + 0.02);
      break;
    }
    case 'credenza': {
      b.box('walnut', 0, (h - 0.12) / 2 + 0.12, 0, w, h - 0.12, d);
      b.box('blackMetal', 0, 0.06, 0, w - 0.1, 0.12, d - 0.08);
      for (let i = 0; i < 4; i++) b.box('gold', -w / 2 + (w / 4) * (i + 0.5), h - 0.12, d / 2 + 0.01, 0.12, 0.012, 0.012);
      break;
    }
    case 'filing': {
      b.box('plasticLight', 0, h / 2, 0, w, h, d);
      for (let i = 0; i < 4; i++) {
        b.box('plasticDark', 0, 0.12 + i * (h / 4), d / 2 + 0.001, w - 0.04, 0.004, 0.002);
        b.box('aluminium', 0, 0.24 + i * (h / 4), d / 2 + 0.012, 0.18, 0.02, 0.02);
      }
      break;
    }
    case 'shelf': {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('aluminium', sx * (w / 2 - 0.02), h / 2, sz * (d / 2 - 0.02), 0.03, h, 0.03);
      const levels = [0.08, 0.55, 1.05, 1.55, h - 0.02];
      for (const y of levels) b.box('aluminium', 0, y, 0, w, 0.02, d);
      let seed = v * 13 + 5;
      const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
      for (const y of levels.slice(0, 4)) {
        let x = -w / 2 + 0.08;
        while (x < w / 2 - 0.3) {
          const bw = 0.25 + rnd() * 0.2;
          const bh = 0.18 + rnd() * 0.22;
          b.box(rnd() < 0.6 ? 'oak' : 'plasticLight', x + bw / 2, y + 0.01 + bh / 2, 0, bw, bh, d * 0.8);
          x += bw + 0.05;
        }
      }
      break;
    }
    case 'bookshelf': {
      b.box('walnut', 0, h / 2, -d / 2 + 0.01, w, h, 0.02);
      for (const sx of [-1, 1]) b.box('walnut', sx * (w / 2 - 0.015), h / 2, 0, 0.03, h, d);
      const shelves = [0.02, 0.42, 0.82, 1.22, 1.62];
      for (const y of [...shelves, h - 0.02]) b.box('walnut', 0, y, 0, w, 0.03, d);
      bookshelfContents(b, w, d, shelves.map((y) => y + 0.015), v);
      break;
    }
    case 'plant':
    case 'plantTall':
      plant(b, f.type === 'plantTall', v + Math.round(f.x * 3));
      break;
    case 'printer': {
      b.box('plasticLight', 0, 0.42, 0, w, 0.84, d);
      b.box('plasticDark', 0, 0.86, 0, w - 0.06, 0.04, d - 0.06);
      b.box('plasticDark', 0, 0.7, d / 2 + 0.06, w - 0.15, 0.02, 0.14);
      b.box('screenOff', w / 2 - 0.12, 0.88, d / 2 - 0.08, 0.14, 0.03, 0.08);
      b.box('ledGreen', w / 2 - 0.05, 0.89, d / 2 - 0.05, 0.01, 0.01, 0.01);
      break;
    }
    case 'copier': {
      b.box('plasticLight', 0, 0.5, 0, w, 1.0, d);
      b.box('plasticDark', 0, 1.05, -0.05, w - 0.1, 0.1, d - 0.2);
      for (let i = 0; i < 3; i++) b.box('plasticDark', 0, 0.2 + i * 0.22, d / 2 + 0.001, w - 0.1, 0.004, 0.003);
      b.box('screenOff', w / 2 - 0.2, 1.1, d / 2 - 0.1, 0.22, 0.04, 0.12);
      break;
    }
    case 'fridge': {
      b.box('fridge', 0, h / 2, 0, w, h, d);
      b.box('glassDark', 0, h / 2 + 0.1, d / 2 + 0.002, w - 0.08, h - 0.45, 0.01);
      for (let r = 0; r < 4; r++) for (let i = 0; i < 4; i++) b.cyl(i % 2 ? 'water' : 'bookA', -w / 2 + 0.15 + i * 0.15, 0.5 + r * 0.33, 0.1, 0.03, 0.03, 0.2, 8);
      b.box('steel', w / 2 - 0.06, h / 2 + 0.2, d / 2 + 0.03, 0.02, 0.5, 0.03);
      b.box('lightStrip', 0, h - 0.18, d / 2 + 0.005, w - 0.1, 0.06, 0.004);
      break;
    }
    case 'waterCooler': {
      b.box('plasticLight', 0, 0.45, 0, w, 0.9, d);
      b.cyl('water', 0, 1.05, 0, 0.13, 0.13, 0.32, 14);
      b.box('plasticDark', 0, 0.62, d / 2 + 0.01, 0.15, 0.05, 0.03);
      break;
    }
    case 'rack': {
      b.box('rack', 0, h / 2, 0, w, h, d);
      b.box('blackMetal', 0, h / 2, d / 2 + 0.005, w - 0.04, h - 0.06, 0.01);
      for (let u = 0; u < 14; u++) {
        const y = 0.2 + u * 0.13;
        b.box('plasticDark', 0, y, d / 2 + 0.012, w - 0.1, 0.09, 0.004);
        b.box((u + v) % 5 === 0 ? 'ledAmber' : (u + v) % 3 === 0 ? 'ledBlue' : 'ledGreen', w / 2 - 0.1, y, d / 2 + 0.016, 0.012, 0.012, 0.004);
        b.box('ledGreen', w / 2 - 0.13, y, d / 2 + 0.016, 0.012, 0.012, 0.004);
      }
      break;
    }
    case 'crac': {
      b.box('plasticLight', 0, h / 2, 0, w, h, d);
      for (let i = 0; i < 10; i++) b.box('plasticDark', 0, 0.3 + i * 0.15, d / 2 + 0.002, w - 0.12, 0.03, 0.004);
      b.box('screenOff', 0, h - 0.25, d / 2 + 0.004, 0.2, 0.12, 0.004);
      break;
    }
    case 'stall': {
      // cubicle: two side partitions and a door, raised off the floor
      for (const sx of [-1, 1]) b.box('laminateWhite', sx * (w / 2 - 0.015), 0.15 + (h - 0.15) / 2, 0, 0.03, h - 0.15, d);
      b.box('laminateWhite', 0, 0.15 + (h - 0.15) / 2, d / 2 - 0.015, w - 0.04, h - 0.15, 0.03);
      b.box('steel', w / 2 - 0.15, 1.0, d / 2 + 0.01, 0.1, 0.03, 0.02);
      for (const sx of [-1, 1]) b.box('steel', sx * (w / 2 - 0.015), 0.075, d / 2 - 0.03, 0.04, 0.15, 0.04);
      b.box('ceramic', 0, 0.22, -d / 2 + 0.35, 0.38, 0.44, 0.55);
      break;
    }
    case 'vanity': {
      b.box('quartz', 0, h, 0, w, 0.05, d);
      b.box('walnut', 0, h - 0.15, 0, w, 0.25, d - 0.04);
      for (const sx of [-0.5, 0.5]) {
        b.box('ceramic', sx * w * 0.5, h + 0.03, 0.02, 0.42, 0.1, 0.34);
        b.cyl('steel', sx * w * 0.5, h + 0.15, -d / 2 + 0.08, 0.015, 0.015, 0.22, 8);
      }
      b.quad('mirror', 0, 1.55, -d / 2 + 0.005, w, 0.9, 0);
      b.box('lightStrip', 0, 2.05, -d / 2 + 0.03, w, 0.03, 0.04);
      break;
    }
    case 'lectern': {
      b.box('walnut', 0, 0.55, 0, w * 0.7, 1.1, d * 0.6);
      b.box('walnut', 0, h - 0.03, 0, w, 0.04, d, 0);
      b.box('gold', 0, 0.9, d * 0.3 + 0.002, w * 0.5, 0.06, 0.004);
      break;
    }
    case 'logoWall': {
      b.box('walnut', 0, h / 2, -0.05, w, h, d - 0.1);
      for (let x = -w / 2 + 0.06; x < w / 2; x += 0.12) b.box('walnut', x, h / 2, d / 2 - 0.04, 0.05, h, 0.08);
      b.box('lightStrip', 0, 0.03, d / 2 + 0.02, w, 0.02, 0.03);
      b.box('lightStrip', 0, h - 0.03, d / 2 + 0.02, w, 0.02, 0.03);
      b.box('signDark', 0, 2.2, d / 2 + 0.005, 3.4, 1.05, 0.02);
      break;
    }
    case 'kiosk': {
      b.box('signDark', 0, h / 2, 0, w, h, d);
      b.box('gold', 0, h - 0.04, d / 2 + 0.002, w - 0.04, 0.01, 0.004);
      b.box('blackMetal', 0, 0.02, 0, w + 0.1, 0.04, d + 0.15);
      break;
    }
    case 'whiteboardStand': {
      for (const sx of [-1, 1]) {
        b.box('aluminium', sx * (w / 2 - 0.02), h / 2, 0, 0.035, h, 0.035);
        b.box('aluminium', sx * (w / 2 - 0.02), 0.03, 0, 0.05, 0.04, d);
      }
      b.box('aluminium', 0, 1.3, 0, w - 0.02, 1.05, 0.03);
      b.box('aluminium', 0, 0.76, 0.06, w - 0.1, 0.02, 0.08);
      break;
    }
    case 'screenStand': {
      b.box('blackMetal', 0, 0.02, 0, w * 0.6, 0.04, d);
      b.box('blackMetal', 0, 0.75, 0, 0.08, 1.5, 0.06);
      b.box('plasticDark', 0, 1.45, 0.04, 1.06, 0.64, 0.05);
      break;
    }
    case 'rug':
      b.box(v === 1 ? 'rugAlt' : 'rug', 0, 0.006, 0, w, 0.012, d);
      break;
    case 'cart': {
      b.box('plasticDark', 0, 0.45, 0, w, 0.06, d);
      b.box('plasticDark', 0, 0.12, 0, w, 0.06, d);
      b.box('plasticLight', 0, 0.75, -d / 4, w - 0.05, 0.5, d / 2 - 0.05);
      legsMetal(b, w, d, 0.9, 0.03, 0.025, 'aluminium');
      break;
    }
    case 'coatStand': {
      b.cyl('blackMetal', 0, h / 2, 0, 0.02, 0.02, h, 8);
      b.cyl('blackMetal', 0, 0.02, 0, 0.2, 0.2, 0.03, 12);
      for (let i = 0; i < 4; i++) b.hcyl('blackMetal', Math.cos(i * 1.57) * 0.1, h - 0.15, Math.sin(i * 1.57) * 0.1, 0.012, 0.2, i * 1.57, 6);
      b.box('chairFabric', 0.12, h - 0.55, 0, 0.1, 0.7, 0.35);
      break;
    }
    case 'boiler': {
      b.cyl('plasticLight', 0, h / 2, 0, 0.28, 0.28, h, 16);
      b.hcyl('steel', 0, h - 0.2, 0.3, 0.025, 0.3, Math.PI / 2, 8);
      break;
    }
    case 'bench': {
      b.box('oak', 0, h - 0.025, 0, w, 0.05, d);
      for (const sx of [-1, 1]) b.box('blackMetal', sx * (w / 2 - 0.15), (h - 0.05) / 2, 0, 0.04, h - 0.05, d - 0.06);
      break;
    }
    default:
      break;
  }
}

/** Chairs are rendered with instancing: these build one prototype per chair type in local space. */
export function buildChairPrototype(b: GeoBuilder, type: FurnItem['type']) {
  switch (type) {
    case 'chairTask': {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        b.box('blackMetal', Math.sin(a) * 0.16, 0.06, Math.cos(a) * 0.16, 0.05, 0.035, 0.32, a);
        b.sphere('rubber', Math.sin(a) * 0.3, 0.03, Math.cos(a) * 0.3, 0.03, 1, 1, 1, 0);
      }
      b.cyl('steel', 0, 0.25, 0, 0.025, 0.03, 0.34, 8);
      b.box('blackMetal', 0, 0.42, 0, 0.3, 0.04, 0.3);
      b.box('chairFabric', 0, 0.465, 0.02, 0.5, 0.07, 0.48);
      b.box('blackMetal', 0, 0.62, -0.25, 0.06, 0.32, 0.04);
      b.box('chairMesh', 0, 0.86, -0.27, 0.46, 0.5, 0.04, 0);
      b.box('blackMetal', 0, 1.11, -0.27, 0.48, 0.035, 0.05);
      for (const sx of [-1, 1]) {
        b.box('blackMetal', sx * 0.25, 0.56, -0.02, 0.03, 0.2, 0.04);
        b.box('rubber', sx * 0.25, 0.67, 0.02, 0.06, 0.03, 0.24);
      }
      break;
    }
    case 'chairExec': {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        b.box('aluminium', Math.sin(a) * 0.17, 0.06, Math.cos(a) * 0.17, 0.05, 0.035, 0.34, a);
        b.sphere('rubber', Math.sin(a) * 0.32, 0.03, Math.cos(a) * 0.32, 0.03, 1, 1, 1, 0);
      }
      b.cyl('steel', 0, 0.25, 0, 0.025, 0.03, 0.34, 8);
      b.box('leather', 0, 0.47, 0.02, 0.54, 0.09, 0.5);
      b.box('leather', 0, 0.92, -0.28, 0.5, 0.7, 0.09);
      b.box('leather', 0, 1.24, -0.29, 0.44, 0.06, 0.08);
      for (const sx of [-1, 1]) {
        b.box('aluminium', sx * 0.28, 0.58, -0.02, 0.03, 0.2, 0.04);
        b.box('leather', sx * 0.28, 0.69, 0.0, 0.07, 0.035, 0.3);
      }
      break;
    }
    case 'chairMeeting': {
      for (const sx of [-1, 1]) {
        b.box('steel', sx * 0.21, 0.015, 0, 0.025, 0.025, 0.5);
        b.box('steel', sx * 0.21, 0.23, 0.23, 0.025, 0.46, 0.025);
        b.box('steel', sx * 0.21, 0.23, -0.2, 0.025, 0.46, 0.025);
        b.box('steel', sx * 0.21, 0.63, -0.03, 0.025, 0.025, 0.42);
      }
      b.box('chairFabric', 0, 0.47, 0.02, 0.48, 0.06, 0.46);
      b.box('chairFabric', 0, 0.75, -0.22, 0.46, 0.4, 0.05, 0);
      break;
    }
    case 'chairCafe': {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('oak', sx * 0.19, 0.22, sz * 0.19, 0.03, 0.44, 0.03);
      b.box('oak', 0, 0.455, 0, 0.44, 0.03, 0.44);
      for (const sx of [-1, 1]) b.box('oak', sx * 0.19, 0.65, -0.2, 0.03, 0.4, 0.03);
      b.box('oak', 0, 0.78, -0.2, 0.42, 0.12, 0.025);
      break;
    }
    case 'stool': {
      b.cyl('blackMetal', 0, 0.38, 0, 0.022, 0.022, 0.74, 8);
      b.cyl('blackMetal', 0, 0.015, 0, 0.2, 0.2, 0.03, 16);
      b.cyl('steel', 0, 0.28, 0, 0.17, 0.17, 0.015, 16, false);
      b.cyl('leather', 0, 0.75, 0, 0.19, 0.17, 0.05, 18);
      break;
    }
    case 'armchair': {
      b.box('blackMetal', 0, 0.05, 0, 0.7, 0.04, 0.7);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('walnut', sx * 0.32, 0.08, sz * 0.32, 0.04, 0.16, 0.04);
      b.box('sofaAlt', 0, 0.3, 0.02, 0.62, 0.22, 0.66);
      b.box('sofaAlt', 0, 0.44, 0.06, 0.56, 0.08, 0.56);
      b.box('sofaAlt', 0, 0.62, -0.3, 0.7, 0.42, 0.14);
      for (const sx of [-1, 1]) b.box('sofaAlt', sx * 0.33, 0.48, 0.0, 0.12, 0.28, 0.68);
      break;
    }
    default:
      break;
  }
}

export const CHAIR_TYPES = ['chairTask', 'chairExec', 'chairMeeting', 'chairCafe', 'stool', 'armchair'] as const;
