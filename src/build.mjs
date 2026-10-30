import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../vendor/anatomy/kit/iso-kit.mjs";
import * as G from "../vendor/anatomy/kit/lathe.mjs";
import { tubePieces, tubeSvg } from "../vendor/anatomy/kit/tube.mjs";
import { kitScript } from "../vendor/anatomy/scripts/inline-kit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes("--light") ? "light" : "dark";

const WIDTH = 660;
const HEIGHT = 520;

// ---- bench plate and lane -------------------------------------------------
const PLATE = { x: -152, y: -104, w: 310, d: 208, r: 10 };
const PLATE_H = 12;
const FOOT_H = 5;
const LANE = { x: -22, y: -104, w: 52, d: 208, r: 1.5 };

// ---- gate cabinet ---------------------------------------------------------
const CAB = { x: -140, y: -20, w: 92, d: 54, r: 5 };
const CAB_TOP = 112;
const CAB_FRONT = CAB.y + CAB.d;
const OPEN_LOW = { x0: -133, x1: -55, z0: 14, z1: 48, r: 4, depth: 6 };
const OPEN_UP = { x0: -133, x1: -55, z0: 54, z1: 102, r: 4, depth: 6 };

// ---- barrier --------------------------------------------------------------
const PIVOT = [-70, 39.5, 88];
const ARM_LEN = 100;
const ARM_OPEN = (76 * Math.PI) / 180;

// ---- camera, IR, monitor, server -----------------------------------------
const CAM_POST = [84, 94];
const CAM_HEAD = [74, 86, 108];
const CAM_TARGET = [4, 48, 12];
const IR_POST = [36, 30];
const IR_LENS = [32, 30, 26];
const MON = { x: 84, y: 8, w: 74, d: 22, r: 4, z0: 58, z1: 122 };
const SCREEN = { x0: 89, x1: 153, z0: 66, z1: 114, r: 2.5, depth: 3 };
const MON_BASE = { x: 92, y: 2, w: 58, d: 34, r: 6 };
const SERVER = { x: 118, y: -78, w: 38, d: 32, r: 3, z0: 0, z1: 30 };

// ---- motorcycle -----------------------------------------------------------
const BIKE_START = 82;
const BIKE_STOP = 73;
const BIKE_EXIT = -82;
const BIKE_HALF = 30;
const BIKE_WIDTH = 17;

const P = k.fitProjection(
  [
    ...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0),
    ...k.boxCorners(CAB, 0, CAB_TOP),
    ...k.boxCorners(MON, MON.z0, MON.z1),
    ...k.boxCorners(SERVER, SERVER.z0, SERVER.z1 + 8),
    [PIVOT[0] + ARM_LEN * Math.cos(ARM_OPEN), PIVOT[1], PIVOT[2] + ARM_LEN * Math.sin(ARM_OPEN)],
    [CAM_POST[0], CAM_POST[1], 114],
    [IR_POST[0], IR_POST[1], 32],
    [-120, 20, 128],
    [BIKE_WIDTH, BIKE_START + BIKE_HALF, 40],
    [BIKE_WIDTH, BIKE_STOP - BIKE_HALF, 76],
    [BIKE_WIDTH, BIKE_EXIT - BIKE_HALF, 40],
  ],
  WIDTH,
  HEIGHT,
  { pad: 46, azimuth: 42, elevation: 30 },
);

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const path3 = (points, closed = false) => k.pathOf(points.map((p) => at(p)), closed);
const sideY = (y, x0, z1) => k.sideMatrix([x0, y], z1, P, "left");

// A local 2D plane on any flat face: origin O, right U, down V, in world units.
function face(O, U, V) {
  const o = k.iso(O, P);
  const u = k.iso([O[0] + U[0], O[1] + U[1], O[2] + U[2]], P);
  const v = k.iso([O[0] + V[0], O[1] + V[1], O[2] + V[2]], P);
  const f = (n) => Math.round(n * 1000) / 1000;
  return `matrix(${f(u[0] - o[0])} ${f(u[1] - o[1])} ${f(v[0] - o[0])} ${f(v[1] - o[1])} ${f(o[0])} ${f(o[1])})`;
}
const faceFront = (y, x0, z1) => face([x0, y, z1], [1, 0, 0], [0, 0, -1]);
const faceSide = (x, y0, z1) => face([x, y0, z1], [0, -1, 0], [0, 0, -1]);

// Recess on a front face (+y), as in the desk-computer example.
let clips = 0;
function recessY({ x0, x1, z0, z1, r, depth }, y, back = "", inside = "", backClass = "pg-well") {
  const id = `pg-clip-${clips++}`;
  const ring = k.roundedPlan({ x: x0, y: z0, w: x1 - x0, d: z1 - z0, r }, 6);
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const { sinA } = k.cameraOf(P);
  const tops = [];
  const sides = [[], [], [], []];
  ring.forEach(([ax, az], index) => {
    const [bx, bz] = ring[(index + 1) % ring.length];
    const length = Math.hypot(bx - ax, bz - az) || 1;
    let [nx, nz] = [(bz - az) / length, -(bx - ax) / length];
    if (nx * (cx - (ax + bx) / 2) + nz * (cz - (az + bz) / 2) < 0) [nx, nz] = [-nx, -nz];
    if (nx <= 0 && nz <= 0) return;
    const quad = k.pathOf([at([ax, y, az]), at([bx, y, bz]), at([bx, y - depth, bz]), at([ax, y - depth, az])], true);
    if (nz >= nx) tops.push(quad);
    else sides[Math.min(3, Math.max(0, Math.floor(((nx * -sinA + 1) / 2) * 4)))].push(quad);
  });
  const shape = k.pathOf(
    k.roundedPlan({ x: x0, y: z0, w: x1 - x0, d: z1 - z0, r }, 6).map(([u, z]) => [u, -z]),
    true,
  );
  const plane = sideY(y, 0, 0);
  const backPlane = sideY(y - depth, 0, 0);
  return [
    `<clipPath id="${id}"><path transform="${plane}" d="${shape}"/></clipPath>`,
    `<g clip-path="url(#${id})">`,
    `<path class="iso-top" d="${tops.join("")}"/>`,
    ...sides.map((d, shade) => (d.length ? `<path class="iso-shade" data-shade="${shade}" d="${d.join("")}"/>` : "")),
    `<g transform="${backPlane}"><path class="${backClass}" d="${shape}"/>${back}</g>`,
    inside,
    `</g>`,
    `<g transform="${plane}"><path class="iso-line" data-tone="lo" d="${shape}"/></g>`,
  ].join("");
}

function plate() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(PLATE, 22))) {
    out.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
  const screws = k.corners(PLATE, 10);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));

  // engraved maker's plate
  const label = { x: -146, y: 76, w: 50, d: 14, r: 1.4 };
  out.push(S(k.slabOf(label, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
  out.push(k.faceTextSvg(k.topMatrix([label.x + 4, label.y + 7.2], 0.8, P, "x"), "GATE MASUK", { size: 3.2, tone: "hi" }));
  out.push(
    L(
      [34, 26, 18]
        .map((w, i) => k.lineOnTop([label.x + 4, label.y + 9.2 + i * 1.7], [label.x + 4 + w, label.y + 9.2 + i * 1.7], 0.8, P))
        .join(""),
      { tone: "lo", free: true },
    ),
  );
  out.push(D([at([label.x + label.w - 3, label.y + label.d / 2, 0.8])], { size: 0.45 }));

  // split ruler strip: clear of the lane
  for (const [from, to] of [[-140, -32], [36, 72], [96, 140]]) {
    const strip = { x: from, y: 96, w: to - from, d: 6, r: 1 };
    out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
    const ticks = k.topTicks(from + 4, to - 4, 4, 5, 96.8, 0.6, [2, 3.6], P);
    out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
    out.push(D([at([from + 2, 99, 0.6]), at([to - 2, 99, 0.6])], { size: 0.45 }));
  }
  return out.join("");
}

function lane() {
  const out = [];
  out.push(S(k.slabOf(LANE, 0, 0.4, P, 2), { tone: "lo", crease: "none", flat: true }));
  out.push(L(k.planOutline(k.insetPlan(LANE, 1.2), 0.4, P, 2), { tone: "faint" }));
  for (const x of [LANE.x + 1.4, LANE.x + LANE.w - 1.4]) {
    out.push(L(k.lineOnTop([x, LANE.y + 1.2], [x, LANE.y + LANE.d - 1.2], 0.45, P), { tone: "mid" }));
  }
  // stop line
  out.push(S(k.slabOf({ x: -20, y: 45, w: 48, d: 1.6, r: 0.8 }, 0.4, 0.35, P, 2), { tone: "hi", crease: "none", flat: true }));
  // approach arrow, pointing to the gate (-y)
  const arrow = [
    [-1, 82], [9, 82], [9, 70], [16, 70], [4, 56], [-8, 70], [-1, 70],
  ];
  out.push(S(k.extrude(arrow, 0.4, 0.35, P, { convex: false }), { tone: "lo", crease: "none", flat: true }));
  // keep-clear hatch beside the stop line
  const hatch = [];
  for (let i = 0; i < 7; i++) {
    const x = -18 + i * 8;
    hatch.push(k.lineOnTop([x, 34], [x + 6, 40], 0.46, P));
  }
  out.push(L(hatch.join(""), { tone: "faint", free: true }));
  return out.join("");
}

function cabinet() {
  const out = [];
  out.push(`<path class="iso-halo" d="${k.haloOf(k.insetPlan(CAB, 2), 0, 8, P)}"/>`);
  for (const [x, y] of byDepth(k.corners(k.insetPlan(CAB, 6), 4))) {
    out.push(S(k.cylinder(x, y, 3.4, 0, 3, P, 20), { tone: "lo" }));
  }
  out.push(S(k.slabOf(k.insetPlan(CAB, 3), 3, 6, P, 6, 0.6), { tone: "lo" }));
  out.push(S(k.slabOf(CAB, 9, 97, P, 6, 1.2), { tone: "mid" }));
  out.push(S(k.slabOf({ x: CAB.x - 2, y: CAB.y - 2, w: CAB.w + 4, d: CAB.d + 4, r: 6 }, 106, 6, P, 6, 1.2), { tone: "hi" }));
  out.push(L(k.planOutline(k.insetPlan({ x: CAB.x - 2, y: CAB.y - 2, w: CAB.w + 4, d: CAB.d + 4, r: 6 }, 4), 112, P, 6), { tone: "lo" }));
  out.push(D(k.corners({ x: CAB.x - 2, y: CAB.y - 2, w: CAB.w + 4, d: CAB.d + 4 }, 8).map(([x, y]) => at([x, y, 112])), { size: 0.5 }));

  // door seam and hinges on the open front
  const door = faceFront(CAB_FRONT, CAB.x + 4, 104);
  out.push(`<g transform="${door}"><path class="iso-line" data-tone="faint" d="${k.pathOf(k.roundedPlan({ x: 0, y: 0, w: CAB.w - 8, d: 93, r: 3 }, 4), true)}"/></g>`);
  for (const z of [28, 84]) {
    out.push(S(k.slabOf({ x: CAB.x, y: 28, w: 5, d: 8, r: 1 }, z, 8, P, 2), { tone: "lo" }));
    out.push(S(k.cylinder(CAB.x + 2.5, 32, 1.6, z + 2, 4, P, 14), { tone: "mid" }));
  }

  // right side: access panel and vents
  const side = faceSide(CAB.x + CAB.w + 0.05, 24, 100);
  const panel = k.roundedPlan({ x: 2, y: 3, w: 30, d: 32, r: 2 }, 5);
  out.push(`<g transform="${side}"><path class="pg-panel" d="${k.pathOf(panel, true)}"/><path class="iso-line" data-tone="lo" d="${k.pathOf(panel, true)}"/>`);
  out.push(`<rect class="pg-screen" x="6" y="5.5" width="22" height="5.5" rx="0.8"/><path class="iso-line" data-tone="faint" data-free="" d="M7.5 8.6H22"/>`);
  out.push(`<text class="pg-ui" x="7.5" y="9.6" font-size="1.9" fill="#cfcfcf">READY</text>`);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      const x = 6 + col * 7.4;
      const y = 13 + row * 4.4;
      out.push(`<rect class="pg-key" x="${x}" y="${y}" width="5.4" height="3.3" rx="0.7"/>`);
      out.push(`<path class="iso-line" data-tone="faint" d="M${(x + 1.5).toFixed(1)} ${(y + 1.65).toFixed(1)}H${(x + 3.9).toFixed(1)}"/>`);
    }
  }
  out.push(`<rect class="pg-slot" x="6" y="31.2" width="21" height="2.2" rx="0.6"/><path class="iso-line" data-tone="mid" data-free="" d="M6.8 32.3H15"/>`);
  out.push(`<circle class="pg-lit" data-part="keypad-led" cx="29" cy="32.3" r="0.9"/>`);
  out.push(`</g>`);
  const vents = faceSide(CAB.x + CAB.w + 0.05, 20, 50);
  out.push(`<g transform="${vents}">`);
  for (let i = 0; i < 5; i++) out.push(`<rect class="pg-slot" x="4" y="${3 + i * 4}" width="26" height="1.4" rx="0.7"/>`);
  out.push(`</g>`);

  // front recesses, with the working interiors
  out.push(recessY(OPEN_LOW, CAB_FRONT, "", electronics()));
  out.push(recessY(OPEN_UP, CAB_FRONT, "", mechanism()));

  // beacon on the roof
  out.push(S(k.cylinder(-120, 20, 6, 112, 3, P, 24), { tone: "lo" }));
  out.push(S(k.cylinder(-120, 20, 1.6, 115, 5, P, 12), { tone: "mid" }));
  out.push(S(G.sphereOf([-120, 20, 123], 4, P), { tone: "hi" }));
  out.push(L([0, 1, 2, 3].map((i) => path3([[-120 + 4 * Math.cos((i / 4) * Math.PI * 2), 20 + 4 * Math.sin((i / 4) * Math.PI * 2), 118], [-120 + 4 * Math.cos((i / 4) * Math.PI * 2), 20 + 4 * Math.sin((i / 4) * Math.PI * 2), 124]])).join(""), { tone: "lo", free: true }));
  out.push(`<circle class="pg-glow" data-part="beacon-glow" cx="${at([-120, 20, 123])[0].toFixed(1)}" cy="${at([-120, 20, 123])[1].toFixed(1)}" r="4.6"/>`);
  return out.join("");
}

function electronics() {
  const out = [];
  // mounting sub-panel and DIN rail
  out.push(S(k.slabOf({ x: -131, y: 17, w: 74, d: 1.4, r: 0.5 }, 16, 30, P, 2), { tone: "lo" }));
  out.push(D([at([-128, 18.8, 19]), at([-60, 18.8, 19]), at([-128, 18.8, 43]), at([-60, 18.8, 43])], { size: 0.35 }));
  out.push(S(k.slabOf({ x: -131, y: 18, w: 74, d: 3, r: 0.5 }, 14, 2, P, 2), { tone: "lo", crease: "none" }));
  for (const x of [-131, -60]) out.push(S(k.slabOf({ x, y: 17.6, w: 2.4, d: 3.8, r: 0.5 }, 14, 5, P, 2), { tone: "mid" }));

  // Pi 5 board
  out.push(S(k.slabOf({ x: -129, y: 18, w: 36, d: 2, r: 0.8 }, 20, 24, P, 3), { tone: "mid" }));
  out.push(L(k.planOutline({ x: -129, y: 18.2, w: 36, d: 1.6, r: 0.8 }, 20.4, P, 3), { tone: "faint" }));
  out.push(D([[-126, 20.2, 22.5], [-96, 20.2, 22.5], [-126, 20.2, 41.5], [-96, 20.2, 41.5]].map(at), { size: 0.28 }));
  // heatsink and fins
  out.push(S(k.slabOf({ x: -120, y: 20, w: 12, d: 3, r: 0.6 }, 30, 8, P, 2), { tone: "mid" }));
  for (let i = 0; i < 5; i++) out.push(S(k.slabOf({ x: -119 + i * 2.2, y: 23, w: 1, d: 2, r: 0.3 }, 30, 8, P, 1), { tone: "hi" }));
  out.push(S(k.slabOf({ x: -106, y: 20, w: 7, d: 2.4, r: 0.5 }, 32, 6, P, 2), { tone: "lo" }));
  // 40-pin header
  out.push(S(k.slabOf({ x: -126, y: 20, w: 28, d: 2.4, r: 0.4 }, 40, 3, P, 2), { tone: "lo" }));
  out.push(D(Array.from({ length: 20 }, (_, i) => at([-125 + i * 1.34, 22.6, 41.5])), { size: 0.2, tone: "faint" }));
  // edge ports
  out.push(S(k.slabOf({ x: -132, y: 18, w: 3, d: 4.5, r: 0.5 }, 24, 3.5, P, 2), { tone: "lo" }));
  out.push(S(k.slabOf({ x: -132, y: 18, w: 3, d: 4.5, r: 0.5 }, 28, 3.5, P, 2), { tone: "lo" }));
  out.push(S(k.slabOf({ x: -132, y: 18, w: 3, d: 5, r: 0.5 }, 33, 5, P, 2), { tone: "lo" }));
  out.push(L([24, 28, 33].map((z) => path3([[-132.1, 21.8, z + 0.6], [-132.1, 21.8, z + 3]])).join(""), { tone: "mid" }));
  out.push(S(k.slabOf({ x: -93, y: 18, w: 3, d: 4, r: 0.5 }, 21, 2.5, P, 2), { tone: "lo" }));
  out.push(S(k.slabOf({ x: -93, y: 18, w: 3, d: 4, r: 0.5 }, 25, 2, P, 2), { tone: "lo" }));
  out.push(S(k.slabOf({ x: -93, y: 18, w: 3, d: 4, r: 0.5 }, 28, 2, P, 2), { tone: "lo" }));
  out.push(k.faceTextSvg(faceFront(20.25, -128, 44), "Pi 5", { size: 1.7, tone: "lo" }));
  out.push(L(k.planOutline({ x: -118, y: 20.2, w: 8, d: 0.4, r: 0 }, 40.2, P, 1), { tone: "faint" }));

  // relay module
  out.push(S(k.slabOf({ x: -88, y: 18, w: 26, d: 2, r: 0.6 }, 20, 22, P, 3), { tone: "mid" }));
  out.push(D([[-85, 20.2, 22.5], [-65, 20.2, 22.5], [-85, 20.2, 39.5], [-65, 20.2, 39.5]].map(at), { size: 0.25 }));
  for (const x of [-85, -73]) {
    out.push(S(k.slabOf({ x, y: 20, w: 10, d: 4, r: 0.8 }, 30, 10, P, 2, 0.4), { tone: "hi" }));
    out.push(L(path3([[x + 1.2, 24.1, 38], [x + 8.8, 24.1, 38]]), { tone: "lo" }));
    out.push(L(path3([[x + 1.2, 24.1, 32], [x + 5.2, 24.1, 32]]), { tone: "faint" }));
  }
  for (const x of [-86, -77, -68]) {
    out.push(S(k.slabOf({ x, y: 20, w: 8, d: 4, r: 0.5 }, 20, 5, P, 2), { tone: "lo" }));
    out.push(D([at([x + 2, 24.2, 25]), at([x + 6, 24.2, 25])], { size: 0.3 }));
  }
  out.push(S(k.slabOf({ x: -80, y: 20, w: 16, d: 2, r: 0.4 }, 40, 2, P, 2), { tone: "lo" }));
  out.push(`<circle class="pg-lit" data-part="relay-led" cx="${at([-84, 20.4, 27])[0].toFixed(1)}" cy="${at([-84, 20.4, 27])[1].toFixed(1)}" r="0.8"/>`);
  out.push(`<circle class="pg-lit" data-part="relay-led2" cx="${at([-72, 20.4, 27])[0].toFixed(1)}" cy="${at([-72, 20.4, 27])[1].toFixed(1)}" r="0.8"/>`);

  // PSU and terminal strip
  out.push(S(k.slabOf({ x: -131, y: 18, w: 19, d: 8, r: 0.8 }, 14, 5, P, 2, 0.4), { tone: "lo" }));
  out.push(L(path3([[-129.5, 26.1, 17.5], [-113.5, 26.1, 17.5]]), { tone: "faint" }));
  out.push(S(k.slabOf({ x: -129, y: 26, w: 6, d: 3, r: 0.5 }, 18, 3, P, 2), { tone: "mid" }));
  out.push(S(k.slabOf({ x: -121, y: 26, w: 6, d: 3, r: 0.5 }, 18, 3, P, 2), { tone: "mid" }));
  out.push(D([at([-126, 29.2, 21]), at([-118, 29.2, 21])], { size: 0.3 }));
  out.push(S(k.slabOf({ x: -90, y: 18, w: 32, d: 6, r: 0.8 }, 14, 4, P, 2), { tone: "lo" }));
  for (const x of [-86, -78, -70, -62]) {
    out.push(S(k.cylinder(x, 21, 1.5, 18, 1.2, P, 12), { tone: "mid" }));
    out.push(D([at([x, 21, 19.2])], { size: 0.3 }));
  }

  // internal wiring
  const wire = (points, tone = "lo") => {
    const flat = points.map((p) => at(p));
    return k.wireSvg(flat[0], flat[flat.length - 1], { via: flat.slice(1, -1), tone, size: 0.7 });
  };
  out.push(wire([[-121, 29.2, 20.5], [-121, 24, 20.5], [-121, 20.4, 23]]));
  out.push(wire([[-104, 22.7, 41], [-100, 22.7, 39], [-92, 22.7, 38], [-88, 22.7, 37]]));
  out.push(wire([[-101, 22.7, 41], [-98, 22.7, 39], [-92, 22.7, 36], [-88, 22.7, 35]]));
  out.push(wire([[-98, 22.7, 41], [-95, 22.7, 39], [-92, 22.7, 34], [-88, 22.7, 33]]));
  out.push(wire([[-70, 24.2, 22], [-70, 23, 40], [-70, 23, 48]]));
  return out.join("");
}

function mechanism() {
  const out = [];
  const F = G.frameAlong([-70, 22, 88], [0, 1, 0]);
  const ringF = G.frameAlong([-70, 28, 88], [0, 1, 0]);
  const springF = G.frameAlong([-70, 0, 88], [0, 1, 0]);

  out.push(S(k.slabOf({ x: -131, y: 17, w: 74, d: 1.4, r: 0.5 }, 56, 44, P, 2), { tone: "lo" }));
  out.push(D([at([-128, 18.8, 59]), at([-60, 18.8, 59]), at([-128, 18.8, 97]), at([-60, 18.8, 97])], { size: 0.35 }));
  out.push(S(k.slabOf({ x: -126, y: 18, w: 20, d: 1.6, r: 1 }, 92, 8, P, 3), { tone: "lo" }));
  out.push(L(path3([[-123, 19.7, 97], [-109, 19.7, 97]]), { tone: "faint" }));
  out.push(L(path3([[-123, 19.7, 95], [-115, 19.7, 95]]), { tone: "faint" }));

  // shaft, keyway
  out.push(S(G.disc(0, 16, 3.5, G.frameAlong([-70, 18, 88], [0, 1, 0]), P, { bevel: 0.3 }), { tone: "hi" }));
  out.push(L(path3([[-70, 18.4, 91.5], [-70, 33.6, 91.5]]), { tone: "lo" }));

  // quadrant sector, holes, teeth and hub boss (rotates live)
  const sector = [[0, 0]];
  for (let i = 0; i <= 26; i++) {
    const a = (-170 * i) / 26 * (Math.PI / 180);
    sector.push([22 * Math.cos(a), 22 * Math.sin(a)]);
  }
  const quad = [];
  quad.push(S(G.prismOf(F, sector, 0, 6, P), { tone: "hi" }));
  for (const phi of [215, 270, 325]) {
    const cx = -70 + 13 * Math.cos((phi * Math.PI) / 180);
    const cz = 88 + 13 * Math.sin((phi * Math.PI) / 180);
    const ring = Array.from({ length: 20 }, (_, i) => {
      const a = (i / 20) * Math.PI * 2;
      return [cx + 2.6 * Math.cos(a), 28.06, cz + 2.6 * Math.sin(a)];
    });
    quad.push(`<path class="pg-hole" d="${path3(ring, true)}"/><path class="iso-line" data-tone="lo" d="${path3(ring, true)}"/>`);
  }
  for (let phi = 195; phi <= 345; phi += 15) {
    const a = (phi * Math.PI) / 180;
    quad.push(L(path3([[-70 + 19 * Math.cos(a), 28.05, 88 + 19 * Math.sin(a)], [-70 + 22 * Math.cos(a), 28.05, 88 + 22 * Math.sin(a)]]), { tone: "lo" }));
  }
  quad.push(S(G.disc(0, 8, 7, F, P, { bevel: 0.5 }), { tone: "mid" }));
  quad.push(D([0, 60, 120, 180, 240, 300].map((a) => at([-70 + 5 * Math.cos((a * Math.PI) / 180), 30.2, 88 + 5 * Math.sin((a * Math.PI) / 180)])), { size: 0.32 }));
  out.push(`<g data-part="quadrant">${quad.join("")}</g>`);

  // torsion spring, bearing ring and bolts (static)
  out.push(L(path3(G.spiral(springF, 30.2, 9, 18, 0, 7 * Math.PI, 84)), { tone: "mid" }));
  out.push(D([at([-79, 30.2, 88]), at([-52, 30.2, 88])], { size: 0.45, tone: "hi" }));
  out.push(S(G.ringBand(0, 4, 3, 8, ringF, P), { tone: "lo" }));
  out.push(D([0, 90, 180, 270].map((a) => at([-70 + 6 * Math.cos((a * Math.PI) / 180), 32.2, 88 + 6 * Math.sin((a * Math.PI) / 180)])), { size: 0.3 }));
  out.push(S(G.disc(0, 2, 1, G.frameAlong([-70, 32, 96], [0, 1, 0]), P), { tone: "hi" }));

  // worm and motor
  const wormF = G.frameAlong([-98, 25, 62], [1, 0, 0]);
  out.push(S(G.disc(0, 36, 4, wormF, P, { bevel: 0.4 }), { tone: "mid" }));
  const thread = k.coil(-98, -62, [25, 62], 4.2, 12, "x", P);
  out.push(L(thread.back, { tone: "faint" }), L(thread.front, { tone: "lo" }));
  const motorF = G.frameAlong([-112, 25, 62], [1, 0, 0]);
  out.push(S(G.disc(0, 14, 7.5, motorF, P, { bevel: 0.8 }), { tone: "mid" }));
  out.push(L(G.ribsOf(motorF, 2, 12, 7.5, 10, P, { phase: 0.2 }), { tone: "lo" }));
  out.push(L([-108, -104, -100].map((x) => G.circleOf(motorF, x + 112, 7.55, P)).join(""), { tone: "faint" }));
  out.push(S(k.slabOf({ x: -108, y: 20, w: 6, d: 10, r: 1 }, 69, 4, P, 2), { tone: "lo" }));
  out.push(D([at([-106, 25, 73]), at([-104, 25, 73])], { size: 0.3 }));
  out.push(S(k.slabOf({ x: -114, y: 18, w: 18, d: 14, r: 1 }, 54, 3, P, 3), { tone: "lo" }));
  out.push(S(k.slabOf({ x: -114, y: 18, w: 4, d: 14, r: 1 }, 54, 8, P, 2), { tone: "lo" }));
  out.push(S(k.slabOf({ x: -100, y: 18, w: 4, d: 14, r: 1 }, 54, 8, P, 2), { tone: "lo" }));
  out.push(S(G.ringBand(0, 6, 7.4, 8.4, G.frameAlong([-108, 25, 62], [1, 0, 0]), P), { tone: "mid" }));
  out.push(S(k.slabOf({ x: -68, y: 18, w: 10, d: 12, r: 1 }, 56, 12, P, 3), { tone: "lo" }));
  out.push(S(G.ringBand(0, 4, 3.8, 5.2, G.frameAlong([-66, 25, 62], [1, 0, 0]), P), { tone: "mid" }));
  out.push(D([at([-64, 21, 58]), at([-64, 21, 66]), at([-64, 29, 58]), at([-64, 29, 66])], { size: 0.3 }));

  // limit switch with roller lever
  out.push(S(k.slabOf({ x: -100, y: 28, w: 6, d: 4, r: 1 }, 74, 4, P, 2, 0.4), { tone: "hi" }));
  out.push(L(path3([[-94, 30, 76], [-91, 30, 80]]), { tone: "mid" }));
  out.push(`<circle class="pg-roller" cx="${at([-91, 30, 80])[0].toFixed(1)}" cy="${at([-91, 30, 80])[1].toFixed(1)}" r="1.1"/>`);

  // relay-to-motor wire, upper half
  const flat = [[-70, 23, 54], [-70, 23, 58], [-80, 24, 62], [-96, 25, 68], [-105, 25, 70]].map(at);
  out.push(k.wireSvg(flat[0], flat[flat.length - 1], { via: flat.slice(1, -1), tone: "lo", size: 0.7 }));
  return out.join("");
}

function arm() {
  const out = [];
  const seg = (30 + 62) / 9;
  for (let i = 0; i < 9; i++) {
    out.push(S(k.slabOf({ x: -62 + i * seg, y: 36, w: seg, d: 6, r: 1.2 }, 84, 8, P, 4, 0.4), { tone: i % 2 ? "mid" : "hi" }));
  }
  out.push(S(k.slabOf({ x: 30, y: 35.5, w: 3, d: 7, r: 1.5 }, 83, 10, P, 4, 0.6), { tone: "hi" }));
  const hubF = G.frameAlong([-70, 33.5, 88], [0, 1, 0]);
  out.push(S(G.disc(0, 10, 7.5, hubF, P, { bevel: 0.6 }), { tone: "hi" }));
  out.push(L(G.circleOf(hubF, 6, 7.5, P), { tone: "faint" }));
  out.push(S(G.disc(0, 1.2, 5.5, G.frameAlong([-70, 43.5, 88], [0, 1, 0]), P, { bevel: 0.3 }), { tone: "mid" }));
  out.push(S(G.disc(0, 0.8, 2.5, G.frameAlong([-70, 44.7, 88], [0, 1, 0]), P), { tone: "lo" }));
  out.push(D([0, 60, 120, 180, 240, 300].map((a) => at([-70 + 6 * Math.cos((a * Math.PI) / 180), 44.8, 88 + 6 * Math.sin((a * Math.PI) / 180)])), { size: 0.35 }));
  out.push(S(k.cylinder(31.5, 39, 2.2, 93, 2, P, 20), { tone: "lo" }));
  out.push(`<g data-part="tip-lamp">${S(G.sphereOf([31.5, 39, 96], 2, P), { tone: "lit", lit: true })}</g>`);
  return `<g data-part="arm">${out.join("")}</g>`;
}

function bike() {
  const out = [];
  const R = 8.6;
  const FRONT = -18;
  const REAR = 18;

  out.push(
    `<g class="pg-bike-shadow">${S(k.slabOf({ x: -8.2, y: -27.5, w: 16.4, d: 57.5, r: 8 }, 0.02, 0.3, P, 8), {
      tone: "lo",
      crease: "none",
      flat: true,
    })}</g>`,
  );

  // ---- wheels -------------------------------------------------------------
  const wheel = (y, half, kind) => {
    const F = G.frameAlong([0, y, R], [1, 0, 0]);
    const face = half;
    out.push(S(G.disc(-half, half, R, F, P, { bevel: 0.5 }), { tone: "lo" }));
    out.push(L(G.ribsOf(F, -half, half, R + 0.03, 16, P, { least: 0.12 }), { tone: "faint" }));
    if (kind === "rear") {
      out.push(S(G.ringBand(face + 0.02, face + 0.3, 4.4, 6.1, F, P), { tone: "mid" }));
      out.push(L(G.spokesOf(F, face + 0.32, 6.1, 6.6, 12, P), { tone: "faint" }));
    } else {
      out.push(S(G.ringBand(face + 0.02, face + 0.26, 3.3, 5.3, F, P), { tone: "lo" }));
      out.push(D(G.dotsOf(F, face + 0.28, 4.25, 6, P), { size: 0.26, tone: "faint" }));
    }
    out.push(S(G.ringBand(face + 0.24, face + 0.64, R * 0.5, R * 0.76, F, P), { tone: "mid" }));
    out.push(L(G.spokesOf(F, face + 0.66, 1.8, R * 0.5, 5, P, { phase: 0.3 }), { tone: "faint" }));
    out.push(S(G.disc(face + 0.44, face + 1.12, 1.9, F, P, { bevel: 0.3 }), { tone: "hi" }));
    out.push(S(G.disc(face + 1.12, face + 1.4, 0.8, F, P, { bevel: 0.2 }), { tone: "lo" }));
  };

  // a mudguard built from short convex segments, so its arc clears the tyre
  const fender = (yc, rIn, rOut, width, fromDeg, toDeg, count) => {
    const F = G.frameAlong([0, 0, 0], [1, 0, 0]);
    const span = ((toDeg - fromDeg) * Math.PI) / 180;
    for (let i = 0; i < count; i++) {
      const a0 = (fromDeg * Math.PI) / 180 + (span * i) / count;
      const a1 = a0 + span / count;
      const p = (r, a) => [yc + r * Math.cos(a), R + r * Math.sin(a)];
      out.push(S(G.prismOf(F, [p(rOut, a0), p(rOut, a1), p(rIn, a1), p(rIn, a0)], -width, width, P), { tone: "mid" }));
    }
  };

  wheel(FRONT, 2.3, "front");
  fender(FRONT, 9.5, 10.9, 2.8, 35, 145, 7);

  // ---- fork, triple clamp, headlamp --------------------------------------
  for (const side of [-1, 1]) {
    const top = [side * 4.3, -14, 36.5];
    const low = [side * 4.3, FRONT, R];
    const d = [0, low[1] - top[1], low[2] - top[2]];
    const len = Math.hypot(d[1], d[2]);
    const F = G.frameAlong(top, d);
    out.push(S(G.disc(0, len, 1.55, F, P, { bevel: 0.3 }), { tone: "mid" }));
    out.push(S(G.disc(0, len * 0.42, 1.1, F, P, { bevel: 0.2 }), { tone: "hi" }));
    out.push(S(G.ringBand(len * 0.4, len * 0.47, 1.1, 1.7, F, P), { tone: "lo" }));
  }
  out.push(S(k.slabOf({ x: -6.6, y: -16.4, w: 13.2, d: 5.4, r: 1.4 }, 34.8, 3.4, P, 4, 0.6), { tone: "mid" }));
  out.push(D([at([-5.4, -14, 38.4]), at([5.4, -14, 38.4])], { size: 0.4 }));
  const lampF = G.frameAlong([0, -16.2, 37.4], [0, -1, 0]);
  out.push(S(G.disc(0, 3.8, 4.0, lampF, P, { bevel: 0.5 }), { tone: "mid" }));
  out.push(S(G.disc(-0.06, 0.16, 3.1, lampF, P), { tone: "lo" }));
  out.push(S(G.ringBand(3.5, 3.9, 3.2, 4.0, lampF, P), { tone: "hi" }));

  // ---- frame --------------------------------------------------------------
  out.push(S(G.disc(0, Math.hypot(5.5, 17), 1.25, G.frameAlong([0, -12.5, 33], [0, 5.5, -17]), P, { bevel: 0.25 }), { tone: "lo" }));

  // ---- engine -------------------------------------------------------------
  out.push(S(k.slabOf({ x: -6.4, y: -3, w: 12.8, d: 12.5, r: 2.6 }, 11.5, 7.5, P, 6, 0.8), { tone: "mid" }));
  out.push(S(k.slabOf({ x: -5.4, y: -1.5, w: 10.8, d: 9.5, r: 1.6 }, 19, 6.5, P, 4, 0.6), { tone: "lo" }));
  for (let i = 0; i < 4; i++) {
    out.push(S(k.slabOf({ x: -6.2, y: -2.4, w: 12.4, d: 11, r: 1.2 }, 19.7 + i * 1.62, 0.55, P, 4, 0.15), { tone: i % 2 ? "hi" : "mid" }));
  }
  const coverF = G.frameAlong([6.4, 3.5, 15.2], [1, 0, 0]);
  out.push(S(G.disc(0, 0.7, 3.6, coverF, P, { bevel: 0.3 }), { tone: "hi" }));
  out.push(L(G.circleOf(coverF, 0.73, 2.5, P), { tone: "faint" }));
  out.push(D(G.dotsOf(coverF, 0.75, 3.0, 6, P), { size: 0.3 }));

  // airbox under the seat
  out.push(S(k.slabOf({ x: -6, y: 5, w: 12, d: 11, r: 2.4 }, 22, 8.5, P, 4, 0.7), { tone: "lo" }));
  for (let i = 0; i < 3; i++) {
    out.push(L(path3([[6.05, 7, 24 + i * 2], [6.05, 14, 24 + i * 2]]), { tone: "faint", free: true }));
  }

  // ---- tank ---------------------------------------------------------------
  const tankF = G.frameAlong([0, 2.2, 31.8], [0, -1, 0]);
  const tankProfile = [[0, 0], [1, 4.6], [4, 7.8], [8, 9], [12, 8.6], [15, 6.6], [16.8, 3.4], [17.6, 0]].map(([s, r], i, list) => [s, r, i && i < list.length - 1 ? 1 : 0]);
  out.push(S(G.lathe(tankProfile, tankF, P, { smooth: { rows: 3 } }), { tone: "hi" }));
  const capF = G.frameAlong([0, -5, 40.4], [0, 0, 1]);
  out.push(S(G.disc(0, 1.0, 2.5, capF, P, { bevel: 0.2 }), { tone: "mid" }));
  out.push(L(G.circleOf(capF, 1.02, 1.9, P), { tone: "faint" }));

  // ---- handlebar, grips, mirrors -----------------------------------------
  const barF = G.frameAlong([-12.4, -13, 43.6], [1, 0, 0]);
  out.push(S(G.disc(0, 24.8, 1.0, barF, P, { bevel: 0.2 }), { tone: "mid" }));
  for (const side of [-1, 1]) {
    const g0 = side > 0 ? 20.6 : 0;
    out.push(S(G.disc(g0, g0 + 4.0, 1.8, barF, P, { bevel: 0.3 }), { tone: "lo" }));
    out.push(S(G.ringBand(g0 + 4.0, g0 + 4.5, 1.0, 1.9, barF, P), { tone: "mid" }));
    const stalk = [side * 10.4, -13, 43.6];
    const head = [side * 15, -13, 47.4];
    const d = [head[0] - stalk[0], 0, head[2] - stalk[2]];
    const len = Math.hypot(d[0], d[2]);
    out.push(S(G.disc(0, len, 0.55, G.frameAlong(stalk, d), P), { tone: "lo" }));
    out.push(S(k.slabOf({ x: side > 0 ? 13.0 : -17.0, y: -14.2, w: 4.0, d: 1.7, r: 1.0 }, 46.8, 3.4, P, 4, 0.7), { tone: "lo" }));
    out.push(S(k.slabOf({ x: side > 0 ? 13.35 : -16.65, y: -14.05, w: 3.3, d: 1.0, r: 0.8 }, 47.0, 3.0, P, 4, 0.5), { tone: "mid" }));
  }

  // ---- seat ---------------------------------------------------------------
  out.push(S(k.slabOf({ x: -6.5, y: 3, w: 13, d: 14.5, r: 2.4 }, 30.8, 4.6, P, 6, 1.2), { tone: "lo" }));
  out.push(L(k.planOutline(k.insetPlan({ x: -6.5, y: 3, w: 13, d: 14.5, r: 2.4 }, 1.4), 35.4, P, 6), { tone: "faint" }));

  // ---- rear wheel, swingarm, shock, chain --------------------------------
  fender(REAR, 9.5, 11.4, 3.8, 35, 130, 9);
  const farArm = G.frameAlong([-4.6, 6.5, 10.5], [0, REAR - 6.5, R - 10.5]);
  out.push(S(G.disc(0, Math.hypot(11.5, 1.9), 1.8, farArm, P, { bevel: 0.3 }), { tone: "mid" }));
  wheel(REAR, 3.2, "rear");
  out.push(L(path3([[3.5, -2, 15.1], [3.5, 18, 14.5]]), { tone: "lo" }));
  out.push(L(path3([[3.5, -2, 10.9], [3.5, 18, 2.7]]), { tone: "lo" }));
  const chainF = G.frameAlong([3.3, -2, 13], [1, 0, 0]);
  out.push(S(G.disc(0, 0.8, 2.4, chainF, P, { bevel: 0.25 }), { tone: "lo" }));
  const nearArm = G.frameAlong([4.6, 6.5, 10.5], [0, REAR - 6.5, R - 10.5]);
  out.push(S(G.disc(0, Math.hypot(11.5, 1.9), 1.8, nearArm, P, { bevel: 0.3 }), { tone: "mid" }));
  out.push(S(G.sphereOf([4.6, 6.5, 10.5], 2.0, P), { tone: "lo" }));
  const shockF = G.frameAlong([5.6, 8, 11.5], [0, 2, 10.8]);
  out.push(S(G.disc(0, 10.98, 1.15, shockF, P, { bevel: 0.25 }), { tone: "lo" }));
  for (let i = 0; i < 7; i++) {
    out.push(L(G.circleOf(shockF, 1.2 + i * 1.4, 1.6, P), { tone: "faint" }));
  }
  out.push(S(G.disc(0, 0.9, 1.6, G.frameAlong([5.6, 8, 11.5], [0, 0, 1]), P), { tone: "mid" }));
  out.push(S(G.disc(10.5, 11.4, 1.6, shockF, P), { tone: "mid" }));

  // ---- exhaust ------------------------------------------------------------
  const exhaustRoute = G.fillet([[4.0, -3.2, 16.8], [7.1, -1.6, 14.4], [8.7, 1.6, 12.2], [8.8, 12.6, 11.6], [8.8, 30.4, 11.6]], 2.6, 5);
  const exhaustR = (t) => 1.3 + 1.45 * (t < 0.5 ? 0 : t > 0.62 ? 1 : (t - 0.5) / 0.12);
  const pieces = tubePieces(exhaustRoute, exhaustR, P, { maxLength: 24, spacing: 1.2 });
  pieces.sort((a, b) => k.depthOf(a.mid, P) - k.depthOf(b.mid, P));
  for (const piece of pieces) out.push(tubeSvg(piece, { tone: "hi" }));
  const portF = G.frameAlong([4.0, -3.2, 16.8], [3.1, 1.6, -2.4]);
  out.push(S(G.disc(-0.35, 0.35, 1.85, portF, P, { bevel: 0.25 }), { tone: "mid" }));
  out.push(`<circle class="pg-pipe" cx="${at([8.8, 30.55, 11.6])[0].toFixed(1)}" cy="${at([8.8, 30.55, 11.6])[1].toFixed(1)}" r="1.35"/>`);

  // ---- tail and plate (rearmost, so drawn last) --------------------------
  out.push(S(k.slabOf({ x: -7, y: 16, w: 14, d: 14, r: 4 }, 26.4, 5.6, P, 6, 1.2), { tone: "mid" }));
  out.push(S(k.slabOf({ x: -6, y: 17.5, w: 12, d: 10.5, r: 2 }, 32, 1.4, P, 4, 0.4), { tone: "lo" }));
  out.push(L(k.planOutline(k.insetPlan({ x: -6, y: 17.5, w: 12, d: 10.5, r: 2 }, 2), 33.4, P, 4), { tone: "faint" }));
  out.push(`<path class="pg-tail" d="${path3([[-4.4, 30.06, 27.3], [4.4, 30.06, 27.3], [4.4, 30.06, 30.1], [-4.4, 30.06, 30.1]], true)}"/>`);
  for (const side of [-1, 1]) {
    out.push(`<circle class="pg-tail" cx="${at([side * 5.6, 30.1, 28.7])[0].toFixed(1)}" cy="${at([side * 5.6, 30.1, 28.7])[1].toFixed(1)}" r="1.15"/>`);
  }
  out.push(S(k.slabOf({ x: -2.6, y: 28.8, w: 5.2, d: 2.2, r: 0.8 }, 24.2, 2.2, P, 4, 0.4), { tone: "lo" }));
  out.push(`<path class="pg-bike-plate" d="${path3([[-7.6, 30.65, 20.2], [7.6, 30.65, 20.2], [7.6, 30.65, 25.2], [-7.6, 30.65, 25.2]], true)}"/>`);
  out.push(k.faceTextSvg(faceFront(30.72, 0, 21.9), "B 1234 XY", { size: 2.05, tone: "lo", anchor: "middle" }));

  // ---- rider: one person --------------------------------------------------
  const limb = (a, b, r, tone) => {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    return S(G.disc(0, Math.hypot(d[0], d[1], d[2]), r, G.frameAlong(a, d), P, { bevel: r * 0.3 }), { tone });
  };
  out.push(S(k.slabOf({ x: -8, y: 1, w: 16, d: 12, r: 5 }, 33.4, 6.0, P, 6, 1.2), { tone: "lo" }));
  for (const side of [-1, 1]) {
    out.push(limb([side * 7.4, 6, 37.5], [side * 10.2, -0.5, 30], 4.2, "lo"));
    out.push(S(G.sphereOf([side * 10.2, -0.5, 30], 3.5, P), { tone: "lo" }));
    out.push(limb([side * 10.2, -0.5, 30], [side * 10.7, 3.2, 21], 3.2, "lo"));
    out.push(S(k.slabOf({ x: side * 10.7 - 1.9, y: 0.6, w: 3.8, d: 6.4, r: 1.4 }, 19.2, 2.2, P, 4, 0.5), { tone: "lo" }));
    out.push(S(G.disc(0, 4, 1.1, G.frameAlong([side > 0 ? 7.6 : -11.6, 3, 18], [1, 0, 0]), P, { bevel: 0.2 }), { tone: "mid" }));
  }

  // far arm goes behind the torso
  out.push(limb([-9.6, 0.5, 53.5], [-12.2, -6, 48.5], 3.0, "mid"));
  out.push(S(G.sphereOf([-12.2, -6, 48.5], 2.6, P), { tone: "mid" }));
  out.push(limb([-12.2, -6, 48.5], [-11.4, -11.4, 44.6], 2.5, "mid"));
  out.push(S(G.sphereOf([-11.2, -12.2, 44.4], 2.6, P), { tone: "lo" }));

  const hipC = [0, 5.5, 37];
  const tf = G.frameAlong(hipC, [0, -7, 18.5]);
  const torsoProfile = [[0, 0], [0.8, 7.2], [3.5, 9.6], [8, 11], [12.5, 11.3], [16, 10.6], [18.4, 8.6], [19.3, 0]].map(([s, r], i, list) => [s, r, i && i < list.length - 1 ? 1 : 0]);
  out.push(S(G.lathe(torsoProfile, tf, P, { smooth: { rows: 3 } }), { tone: "mid" }));
  out.push(S(G.ringBand(2.2, 3.2, 8.9, 10.2, tf, P), { tone: "lo" }));
  out.push(L(G.arcOf(tf, 12, 11.25, P), { tone: "faint" }));
  const neckF = G.frameAlong([0, -0.4, 53.5], [0, -1.2, 6.6]);
  out.push(S(G.disc(0, 6.6, 2.9, neckF, P, { bevel: 0.4 }), { tone: "lo" }));

  // near arm in front of the torso
  out.push(limb([9.6, 0.5, 53.5], [12.2, -6, 48.5], 3.0, "mid"));
  out.push(S(G.sphereOf([12.2, -6, 48.5], 2.6, P), { tone: "mid" }));
  out.push(limb([12.2, -6, 48.5], [11.4, -11.4, 44.6], 2.5, "mid"));
  out.push(S(G.sphereOf([11.2, -12.2, 44.4], 2.6, P), { tone: "lo" }));

  out.push(S(G.sphereOf([0, -2.4, 65.0], 6.8, P), { tone: "hi" }));
  out.push(S(k.slabOf({ x: -2.2, y: 3.9, w: 4.4, d: 1.4, r: 0.7 }, 64.9, 1.4, P, 4, 0.4), { tone: "mid" }));

  return `<g data-part="bike" transform="${k.translateAlong(P, [0, BIKE_STOP, 0])}">${out.join("")}</g>`;
}

function camera() {
  const out = [];
  out.push(`<path class="iso-halo" d="${k.haloOf({ x: CAM_POST[0] - 8, y: CAM_POST[1] - 8, w: 16, d: 16, r: 8 }, 0, 3, P)}"/>`);
  out.push(S(k.cylinder(CAM_POST[0], CAM_POST[1], 7, 0, 2.4, P, 24), { tone: "lo" }));
  out.push(S(k.cylinder(CAM_POST[0], CAM_POST[1], 5.2, 2.4, 1.2, P, 24), { tone: "mid" }));
  out.push(S(k.cylinder(CAM_POST[0], CAM_POST[1], 3.6, 3.6, 92, P, 20), { tone: "mid" }));
  out.push(L([14, 32, 50, 70].map((z) => k.ring(CAM_POST[0], CAM_POST[1], 3.62, z, P, 18)).join(""), { tone: "faint" }));
  out.push(S(k.cylinder(CAM_POST[0], CAM_POST[1], 4.4, 92, 5, P, 20), { tone: "lo" }));
  out.push(S(G.sphereOf([CAM_POST[0], CAM_POST[1], 98.5], 3.2, P), { tone: "hi" }));

  // diagonal arm and knuckle
  const armF = G.frameAlong([84, 94, 95], [-10, -8, 9]);
  out.push(S(G.disc(0, 15.6, 2.3, armF, P, { bevel: 0.3 }), { tone: "mid" }));
  out.push(S(G.sphereOf([74, 86, 104], 3.4, P), { tone: "mid" }));

  // Camera Module V3, aimed at the lane
  const F = G.frameAlong(CAM_HEAD, [CAM_TARGET[0] - CAM_HEAD[0], CAM_TARGET[1] - CAM_HEAD[1], CAM_TARGET[2] - CAM_HEAD[2]]);
  const board = k.roundedPlan({ x: -12, y: -8, w: 24, d: 16, r: 2.2 }, 4);
  out.push(S(G.prismOf(F, board, -2, 2, P), { tone: "hi" }));
  out.push(S(G.prismOf(F, k.roundedPlan({ x: -4.5, y: -4.5, w: 9, d: 9, r: 1 }, 3), -2.6, 0.4, P), { tone: "lo" }));
  out.push(S(G.prismOf(F, k.roundedPlan({ x: -8.5, y: 5.2, w: 5, d: 2, r: 0.5 }, 3), -2.5, 0.5, P), { tone: "mid" }));
  out.push(S(G.ringBand(2, 4.4, 3.9, 4.7, F, P), { tone: "mid" }));
  out.push(S(G.disc(2, 2.7, 3.9, F, P, { bevel: 0.2 }), { tone: "hi" }));
  out.push(S(G.disc(2.7, 4.3, 3.7, F, P), { tone: "lo" }));
  out.push(`<path class="pg-lens" d="${G.circleOf(F, 4.32, 2.9, P)}"/>`);
  out.push(L(G.circleOf(F, 4.35, 2.9, P), { tone: "faint" }));
  const led = G.pointOf(F, 2.05, 7.2, Math.PI * 0.82);
  out.push(`<circle class="pg-lit" data-on cx="${at(led)[0].toFixed(1)}" cy="${at(led)[1].toFixed(1)}" r="0.75"/>`);
  const cable = G.pointOf(F, -2.2, 0, 0);
  const flat = [cable, [76, 90, 100], [80, 93, 94], [84, 94, 78], [84, 94, 20], [84, 82, 4], [68, 20, 1.8], [34, 20, 1.8], [-30, 20, 1.8]].map(at);
  out.push(k.wireSvg(flat[0], flat[flat.length - 1], { via: flat.slice(1, -1), tone: "lo", size: 0.7 }));
  return out.join("");
}

function irSensor() {
  const out = [];
  const [px, py] = IR_POST;
  out.push(S(k.cylinder(px, py, 5.2, 0, 2, P, 20), { tone: "lo" }));
  out.push(S(k.cylinder(px, py, 2.9, 2, 18.5, P, 16), { tone: "mid" }));
  out.push(S(k.cylinder(px, py, 3.6, 20.5, 2, P, 16), { tone: "lo" }));
  out.push(S(k.slabOf({ x: px - 4, y: py - 5, w: 10, d: 10, r: 2.4 }, 22, 10, P, 4, 0.5), { tone: "hi" }));
  out.push(S(k.slabOf({ x: px - 4.4, y: py - 5.4, w: 10.8, d: 10.8, r: 2.6 }, 31.4, 1.4, P, 4), { tone: "lo" }));
  const lensF = G.frameAlong([IR_LENS[0] + 1.2, IR_LENS[1], IR_LENS[2]], [-1, 0, 0]);
  out.push(S(G.disc(0, 1.6, 2.5, lensF, P, { bevel: 0.2 }), { tone: "mid" }));
  out.push(`<path class="pg-lens" d="${G.circleOf(lensF, 1.62, 1.9, P)}"/>`);
  out.push(L(G.circleOf(lensF, 1.66, 1.9, P), { tone: "faint" }));
  out.push(`<circle class="pg-lit" data-on cx="${at([px - 3, py + 2.6, 31])[0].toFixed(1)}" cy="${at([px - 3, py + 2.6, 31])[1].toFixed(1)}" r="0.55"/>`);

  // through-beam across the lane, from the emitter to the cabinet side
  const beam = [[IR_LENS[0] - 0.6, IR_LENS[1] - 1.2, 25.4], [IR_LENS[0] - 0.6, IR_LENS[1] + 1.2, 25.4], [-45, 32.2, 24.8], [-45, 27.8, 24.8]];
  out.push(`<g data-part="ir-beam"><path class="pg-beam" d="${path3(beam, true)}"/><path class="pg-beam-line" d="${path3([[IR_LENS[0] - 0.6, IR_LENS[1], 25.4], [-45, 30, 24.8]])}"/></g>`);
  return out.join("");
}

function screen() {
  const out = [];
  out.push(`<rect x="0" y="0" width="64" height="48" fill="#0a0c0d"/>`);
  out.push(`<rect x="1" y="1" width="62" height="29.5" rx="1.2" fill="#0f1416"/>`);
  out.push(`<path d="M1 10.5H63M1 20.5H63M21 1V30.5M43 1V30.5" stroke="#1a2326" stroke-width=".35"/>`);
  out.push(`<path d="M19.5 30.5 27.5 11M44.5 30.5 36.5 11" stroke="#2b3a3d" stroke-width=".5"/>`);
  out.push(`<rect x="25" y="17.6" width="14" height="11" rx="1.6" fill="#263336" stroke="#3d5154" stroke-width=".35"/>`);
  out.push(`<rect x="27.4" y="19.3" width="9.2" height="4" rx=".7" fill="#0e1517"/>`);
  out.push(`<rect x="28.8" y="24.6" width="6.4" height="1.7" rx=".25" fill="#cfd8d6"/>`);
  out.push(`<g data-part="screen-box"><path d="M21.5 15.6h3M21.5 15.6v3M42.5 15.6h-3M42.5 15.6v3M21.5 28.4h3M21.5 28.4v-3M42.5 28.4h-3M42.5 28.4v-3" stroke="#6be0a0" stroke-width=".55" fill="none"/><text x="21.5" y="14.5" font-size="1.7" fill="#6be0a0" font-family="ui-monospace,monospace">plat</text></g>`);
  out.push(`<rect data-part="screen-scan" x="1" y="1" width="62" height=".65" fill="#6be0a0" opacity=".16"/>`);
  out.push(`<circle cx="3" cy="3.2" r=".7" fill="#6be0a0"/>`);
  out.push(`<text x="5.1" y="4.2" font-size="1.9" fill="#9fb0ad" font-family="ui-monospace,monospace">CAM-01 · 960×720</text>`);
  out.push(`<text x="61.6" y="4.2" font-size="1.9" fill="#6b7a78" text-anchor="end" font-family="ui-monospace,monospace">15 fps</text>`);
  out.push(`<path d="M1 26.5 24 1H33L1 31Z" fill="#ffffff" opacity=".025"/>`);
  out.push(`<rect x="1" y="30.5" width="62" height="16.5" rx="1.2" fill="#111719"/>`);
  out.push(`<text data-part="screen-status" x="3" y="40.2" font-size="6.6" fill="#e8f2ef" font-family="ui-monospace,monospace" font-weight="600" letter-spacing=".04em">PINDAI</text>`);
  out.push(`<text data-part="screen-frames" x="61.5" y="36.2" font-size="2.2" fill="#9fb0ad" text-anchor="end" font-family="ui-monospace,monospace">3/5</text>`);
  out.push(`<text data-part="screen-note" x="3" y="43.7" font-size="1.8" fill="#6b7a78" font-family="ui-monospace,monospace">5 frame stabil</text>`);
  out.push(`<rect x="3" y="45.5" width="58" height="1.3" rx=".65" fill="#1d282a"/>`);
  out.push(`<rect data-part="screen-progress" x="3" y="45.5" width="34.8" height="1.3" rx=".65" fill="#6be0a0"/>`);
  return out.join("");
}

function monitor() {
  const out = [];
  out.push(`<path class="iso-halo" d="${k.haloOf(MON_BASE, 0, 7, P)}"/>`);
  out.push(S(k.slabOf(k.insetPlan(MON_BASE, 3), 0, 3, P, 8), { tone: "lo" }));
  out.push(S(k.slabOf(MON_BASE, 3, 4, P, 8, 0.8), { tone: "mid" }));
  out.push(D(k.corners(k.insetPlan(MON_BASE, 7), 0).map(([x, y]) => at([x, y, 7])), { size: 0.4 }));
  out.push(S(k.slabOf({ x: 108, y: 11, w: 30, d: 14, r: 4 }, 7, 51, P, 6), { tone: "mid" }));
  out.push(S(k.slabOf({ x: 112, y: 17, w: 22, d: 4, r: 2 }, 18, 28, P, 4), { tone: "lo" }));
  out.push(S(k.slabOf({ x: 106, y: 6, w: 34, d: 26, r: 5 }, 55, 3, P, 6), { tone: "lo" }));
  out.push(S(k.slabOf(MON, MON.z0, MON.z1 - MON.z0, P, 8, 1.4), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(MON, 3), MON.z1, P, 8), { tone: "faint" }));
  out.push(D(k.corners(k.insetPlan(MON, 4), 0).map(([x, y]) => at([x, y, MON.z1])), { size: 0.4 }));

  // bezel, screen well and the live feed on its back plane
  out.push(recessY(SCREEN, MON.y + MON.d, `<g transform="translate(${SCREEN.x0} ${-SCREEN.z1})">${screen()}</g>`, "", "pg-glass"));
  const bezel = k.roundedPlan({ x: SCREEN.x0 - 2, y: SCREEN.z0 - 2, w: SCREEN.x1 - SCREEN.x0 + 4, d: SCREEN.z1 - SCREEN.z0 + 4, r: 4 }, 6);
  out.push(`<g transform="${sideY(MON.y + MON.d + 0.06, 0, 0)}"><path class="pg-bezel" d="${k.pathOf(bezel.map(([u, z]) => [u, -z]), true)}"/></g>`);
  out.push(k.faceTextSvg(faceFront(MON.y + MON.d + 0.08, 118, 63.6), "INFO", { size: 3, tone: "mid", anchor: "middle" }));
  out.push(`<circle class="pg-lit" data-on cx="${at([146, MON.y + MON.d + 0.08, 118])[0].toFixed(1)}" cy="${at([146, MON.y + MON.d + 0.08, 118])[1].toFixed(1)}" r="0.7"/>`);

  // side vents and a small camera above the screen
  const side = faceSide(MON.x + MON.w + 0.05, 14, 116);
  out.push(`<g transform="${side}">${Array.from({ length: 6 }, (_, i) => `<rect class="pg-slot" x="3" y="${10 + i * 5}" width="14" height="1.4" rx=".7"/>`).join("")}</g>`);
  out.push(S(k.slabOf({ x: 114, y: MON.y + MON.d - 1, w: 8, d: 2, r: 2 }, 116, 2.4, P, 4), { tone: "lo" }));
  out.push(`<circle class="pg-lens-dot" cx="${at([118, MON.y + MON.d + 0.1, 117.2])[0].toFixed(1)}" cy="${at([118, MON.y + MON.d + 0.1, 117.2])[1].toFixed(1)}" r="1.1"/>`);
  return out.join("");
}

function server() {
  const out = [];
  out.push(`<path class="iso-halo" d="${k.haloOf(SERVER, 0, 5, P)}"/>`);
  out.push(S(k.slabOf(k.insetPlan(SERVER, 2), 0, 2.4, P, 6), { tone: "lo" }));
  out.push(S(k.slabOf(SERVER, 2.4, SERVER.z1 - 2.4, P, 6, 1), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(SERVER, 3), SERVER.z1, P, 6), { tone: "faint" }));
  const front = SERVER.y + SERVER.d + 0.05;
  const panel = faceFront(front, SERVER.x + 5, SERVER.z1 - 2);
  out.push(`<g transform="${panel}"><rect class="pg-server-panel" x="0" y="0" width="${SERVER.w - 10}" height="23" rx="1.6"/></g>`);
  out.push(`<g transform="${panel}">`);
  for (let i = 0; i < 3; i++) out.push(`<rect class="pg-slot" x="2" y="${3 + i * 4.6}" width="26" height="3" rx=".6"/>`);
  for (let i = 0; i < 4; i++) out.push(`<circle class="pg-lit" data-on cx="${3.5 + i * 3}" cy="19.4" r=".7"/>`);
  out.push(`<text x="14" y="21.3" font-size="2.1" fill="#8d9a98" font-family="ui-monospace,monospace">EDGE-01</text>`);
  out.push(`</g>`);
  // recessed vent grille on the lid, its grooves ending on the panel edge
  const vent = { x: SERVER.x + 4, y: SERVER.y + 4, w: SERVER.w - 8, d: SERVER.d - 8 };
  out.push(`<g transform="${k.topMatrix([vent.x, vent.y], SERVER.z1 + 0.02, P, "x")}">`);
  out.push(`<rect class="pg-slot" x="0" y="0" width="${vent.w}" height="${vent.d}" rx="2"/>`);
  out.push(`<rect class="iso-line" data-tone="faint" x=".7" y=".7" width="${vent.w - 1.4}" height="${vent.d - 1.4}" rx="1.5"/>`);
  for (let i = 0; i < 6; i++) {
    out.push(`<path class="iso-line" data-tone="faint" d="M1.6 ${5.4 + i * 3.4}H${vent.w - 1.6}"/>`);
  }
  out.push(`</g>`);
  out.push(S(k.cylinder(SERVER.x + SERVER.w - 7, SERVER.y + 7, 1.3, SERVER.z1, 13, P, 12), { tone: "lo" }));
  out.push(`<circle class="pg-lit" data-on cx="${at([SERVER.x + SERVER.w - 7, SERVER.y + 7, SERVER.z1 + 13.4])[0].toFixed(1)}" cy="${at([SERVER.x + SERVER.w - 7, SERVER.y + 7, SERVER.z1 + 13.4])[1].toFixed(1)}" r="0.8"/>`);
  for (const [x, y] of k.corners(k.insetPlan(SERVER, 4), 0)) {
    out.push(S(k.cylinder(x, y, 1.8, 0, 2.4, P, 12), { tone: "lo" }));
  }
  return out.join("");
}

function floorCables() {
  const out = [];
  const duct = { x: -26, y: -94, w: 58, d: 10, r: 2 };
  out.push(S(k.slabOf(duct, 0, 0.8, P, 6), { tone: "lo", crease: "none" }));
  for (const y of [duct.y + 0.4, duct.y + duct.d - 1.6]) {
    out.push(S(k.slabOf({ x: duct.x, y, w: duct.w, d: 1.2, r: 0.6 }, 0.8, 1.3, P, 3), { tone: "mid" }));
  }
  out.push(L([-22, -12, -2, 8, 18, 28].map((x) => k.lineOnTop([x, duct.y + 1.8], [x, duct.y + duct.d - 1.8], 0.82, P)).join(""), { tone: "faint" }));
  const run = (points, tone = "lo", size = 0.7) => {
    const flat = points.map(at);
    out.push(k.wireSvg(flat[0], flat[flat.length - 1], { via: flat.slice(1, -1), tone, size }));
  };
  run([[130, -46, 4], [130, -60, 1.5], [130, -88, 1.5], [34, -88, 1.5], [-30, -88, 1.5], [-96, -88, 1.5], [-96, -60, 1.5], [-96, -30, 1.5], [-100, -20, 6]], "lo");
  run([[74, 82, 6], [74, 20, 1.5], [74, -80, 1.5], [34, -86, 1.5], [-30, -86, 1.5], [-94, -86, 1.5], [-94, -50, 1.5], [-98, -20, 6]], "mid");
  run([[36, 30, 2], [36, 18, 1.5], [-46, 18, 4]], "lo", 0.55);
  run([[140, 20, 3], [146, 2, 1.5], [146, -40, 1.5], [140, -46, 6]], "mid", 0.55);
  out.push(D([[62, 40, 1.5], [62, 0, 1.5], [62, -60, 1.5], [-70, -88, 1.5], [-96, -70, 1.5]].map(at), { size: 0.45, tone: "mid" }));
  return out.join("");
}

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: "Gerbang masuk parkir kampus: satu sepeda motor dengan satu pengendara berhenti di garis, kamera memindai plat nomor, relay membuka palang, dan layar info menampilkan status.",
  body: [
    plate(),
    lane(),
    floorCables(),
    irSensor(),
    server(),
    monitor(),
    cabinet(),
    arm(),
    camera(),
    bike(),
  ],
});

const css = `<style>
.iso[data-theme="dark"]{
  --anatomy-shade-0:#17171a;--anatomy-shade-1:#1b1b1f;--anatomy-shade-2:#202026;--anatomy-shade-3:#26262d;
  --anatomy-faint:#33333b;--anatomy-lo:#4e4e58;--anatomy-mid:#8b8b95;
}
.pg-well{fill:var(--anatomy-shade-1)}
.pg-glass{fill:#0a0c0d}
.pg-panel{fill:var(--anatomy-shade-1)}
.pg-key{fill:var(--anatomy-shade-2);stroke:var(--anatomy-lo);stroke-width:.3}
.pg-slot{fill:var(--anatomy-shade-0)}
.pg-lit{fill:var(--anatomy-lo);transition:fill .25s var(--anatomy-ease)}
.pg-lit[data-on]{fill:var(--anatomy-green)}
.pg-glow{fill:var(--anatomy-green);opacity:.12;filter:blur(5px);transition:opacity .35s var(--anatomy-ease),fill .35s var(--anatomy-ease)}
.pg-glow[data-state="ok"]{opacity:.5}
.pg-glow[data-state="bad"]{fill:var(--anatomy-red);opacity:.55}
.pg-roller{fill:var(--anatomy-hi)}
.pg-hole{fill:var(--anatomy-shade-0)}
.pg-bezel{fill:none;stroke:var(--anatomy-lo);stroke-width:1.4;stroke-linejoin:round}
.pg-lens{fill:#080a0b}
.pg-lens-dot{fill:#0a0c0d;stroke:var(--anatomy-lo);stroke-width:.35}
.pg-server-panel{fill:var(--anatomy-shade-0)}
.pg-beam{fill:var(--anatomy-red);opacity:.055}
.pg-beam-line{fill:none;stroke:var(--anatomy-red);stroke-width:.4;stroke-dasharray:1 2.2;opacity:.35;vector-effect:non-scaling-stroke}
[data-part="ir-beam"]{opacity:1;transition:opacity .3s var(--anatomy-ease)}
[data-part="ir-beam"][data-blocked]{opacity:1}
[data-part="ir-beam"][data-blocked] .pg-beam{opacity:.16}
[data-part="ir-beam"][data-blocked] .pg-beam-line{opacity:.85}
.pg-bike-shadow .iso-fill{fill:var(--anatomy-halo);opacity:.5}
.pg-bike-shadow .iso-edge{stroke:none}
.pg-tail{fill:var(--anatomy-red);opacity:.9}
.pg-bike-plate{fill:#d9d9d4}
.pg-pipe{fill:var(--anatomy-shade-0);stroke:var(--anatomy-lo);stroke-width:.35}
[data-part="screen-status"]{transition:fill .2s var(--anatomy-ease)}
[data-part="screen-status"][data-state="ok"]{fill:#6be0a0}
[data-part="screen-status"][data-state="bad"]{fill:#ff6b6b}
[data-part="screen-progress"]{transition:width .2s linear,fill .2s var(--anatomy-ease)}
[data-part="screen-progress"][data-state="bad"]{fill:#ff6b6b}
[data-part="screen-box"]{opacity:.3;transition:opacity .3s var(--anatomy-ease)}
[data-part="screen-box"][data-on]{opacity:1}
[data-part="screen-scan"]{animation:pg-scan 2.4s linear infinite}
@keyframes pg-scan{from{transform:translateY(0)}to{transform:translateY(27px)}}
[data-part="bike"]{cursor:grab}
[data-part="bike"]:active{cursor:grabbing}
.iso-stage{touch-action:pan-y}
.iso-stage:focus{outline:none}
.iso-stage:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:6px}
.pg-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
@media (prefers-reduced-motion:reduce){
  [data-part="screen-scan"]{animation:none}
  .pg-lit,.pg-glow,[data-part="screen-status"],[data-part="screen-progress"]{transition:none}
}
</style>`;

const live = `
const P = ${JSON.stringify(P)};
const PIVOT = ${JSON.stringify(PIVOT)};
const BIKE_START = ${BIKE_START}, BIKE_STOP = ${BIKE_STOP}, BIKE_EXIT = ${BIKE_EXIT};
const ARM_OPEN = ${ARM_OPEN};
const WIDTH = ${WIDTH}, HEIGHT = ${HEIGHT};
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const bike = svg.querySelector('[data-part="bike"]');
const arm = svg.querySelector('[data-part="arm"]');
const quad = svg.querySelector('[data-part="quadrant"]');
const beam = svg.querySelector('[data-part="ir-beam"]');
const beacon = svg.querySelector('[data-part="beacon-glow"]');
const relayLed = svg.querySelector('[data-part="relay-led"]');
const relayLed2 = svg.querySelector('[data-part="relay-led2"]');
const screenStatus = svg.querySelector('[data-part="screen-status"]');
const screenFrames = svg.querySelector('[data-part="screen-frames"]');
const screenNote = svg.querySelector('[data-part="screen-note"]');
const screenProgress = svg.querySelector('[data-part="screen-progress"]');
const screenBox = svg.querySelector('[data-part="screen-box"]');
const readout = document.querySelector("[data-readout]");
const status = document.querySelector("[data-status]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const record = location.hash === "#record";
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
const ax = axisVector(P, [1, 0, 0]);
const az = axisVector(P, [0, 0, 1]);
const pivot = iso(PIVOT, P);
function armMatrix(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const Ax = c * ax[0] + s * az[0], Ay = c * ax[1] + s * az[1];
  const Bx = -s * ax[0] + c * az[0], By = -s * ax[1] + c * az[1];
  const tx = pivot[0] - (Ax * pivot[0] + Bx * pivot[1]);
  const ty = pivot[1] - (Ay * pivot[0] + By * pivot[1]);
  return "matrix(" + Ax + " " + Ay + " " + Bx + " " + By + " " + tx + " " + ty + ")";
}
let y = BIKE_STOP, angle = 0, phase = "scan", pt = 0.74, frames = 3, kind = 0, pass = 0;
let opacity = 1, relay = false, approachFrom = BIKE_START;
let dragging = false, visible = false, frame = 0, last = 0;
const laneA = iso([4, BIKE_START, 0], P), laneB = iso([4, BIKE_EXIT, 0], P);
function enter(next) { phase = next; pt = 0; }
function cycle(nextKind) {
  kind = nextKind === undefined ? 0 : nextKind;
  y = BIKE_START; approachFrom = BIKE_START; opacity = 1; frames = 0; relay = false; angle = 0;
  enter("approach");
  run();
}
function draw() {
  bike.setAttribute("transform", translateAlong(P, [0, y, 0]));
  bike.style.opacity = opacity.toFixed(2);
  arm.setAttribute("transform", armMatrix(angle));
  quad.setAttribute("transform", armMatrix(angle));
  const open = phase === "open" || phase === "pass" || phase === "exit" || (phase === "still" && angle > 0.1);
  const bad = phase === "deny" || phase === "reverse" || (phase === "still" && kind === 1);
  beacon.setAttribute("data-state", bad ? "bad" : open ? "ok" : "idle");
  for (const led of [relayLed, relayLed2]) {
    if (relay) led.setAttribute("data-on", ""); else led.removeAttribute("data-on");
  }
  const blocked = y < 60 && y > 2;
  if (blocked) beam.setAttribute("data-blocked", ""); else beam.removeAttribute("data-blocked");
  let word = "SIAP", note = "siap", state = "";
  if (phase === "approach") { word = "CARI"; note = "motor mendekat"; }
  if (phase === "manual") { word = "CARI"; note = "motor digeser"; }
  if (phase === "scan") { word = "PINDAI"; note = "5 frame stabil"; }
  if (phase === "pulse") { word = "PINDAI"; note = "relay 0.5 s"; state = "ok"; }
  if (phase === "open") { word = "TERBUKA"; note = "relay 0.5 s"; state = "ok"; }
  if (phase === "pass" || phase === "exit") { word = "TERBUKA"; note = "IR jaga 2 s"; state = "ok"; }
  if (phase === "deny") { word = "TOLAK"; note = "plat tidak cocok"; state = "bad"; }
  if (phase === "reverse") { word = "ULANG"; note = "motor mundur"; state = "bad"; }
  if (phase === "still") { word = angle > 0.1 ? "TERBUKA" : "PINDAI"; note = angle > 0.1 ? "mode tenang" : "5 frame stabil"; state = angle > 0.1 ? "ok" : ""; }
  if (screenStatus.textContent !== word) screenStatus.textContent = word;
  if (screenNote.textContent !== note) screenNote.textContent = note;
  screenStatus.setAttribute("data-state", state);
  const frameText = phase === "deny" || phase === "reverse" ? "0/5" : frames + "/5";
  if (screenFrames.textContent !== frameText) screenFrames.textContent = frameText;
  const progress = phase === "deny" || phase === "reverse" ? 0 : 58 * frames / 5;
  screenProgress.setAttribute("width", progress.toFixed(1));
  screenProgress.setAttribute("data-state", state === "bad" ? "bad" : "");
  if (phase === "scan" || phase === "pulse" || phase === "deny") screenBox.setAttribute("data-on", ""); else screenBox.removeAttribute("data-on");
  let line = "siap · motor berikutnya";
  if (phase === "approach") line = "mendekat · gerbang tertutup";
  if (phase === "manual") line = "manual · lepas untuk memindai";
  if (phase === "scan") line = "memindai · " + frames + "/5 frame";
  if (phase === "pulse") line = "relay aktif · 0.5 detik";
  if (phase === "open") line = "membuka · lengan 76°";
  if (phase === "pass") line = "motor lewat · IR 2 detik";
  if (phase === "exit") line = pt > 1.05 ? "menutup · IR clear" : "motor lewat · IR 2 detik";
  if (phase === "deny") line = "ditolak · reset 3 detik";
  if (phase === "reverse") line = "mengulang · motor mundur";
  if (phase === "still") line = angle > 0.1 ? "terbuka · mode tenang" : "memindai · 3/5 frame";
  if (readout.textContent !== line) readout.textContent = line;
  if (status && status.dataset.phase !== phase) { status.dataset.phase = phase; status.textContent = word + " · " + note; }
}
function step(dt) {
  if (!dragging) pt += dt;
  switch (phase) {
    case "approach": {
      const t = clamp(pt / 1.25, 0, 1);
      y = lerp(approachFrom, BIKE_STOP, ease(t));
      if (t >= 1) enter("scan");
      break;
    }
    case "scan": {
      frames = Math.min(5, Math.floor(pt / 0.24));
      if (pt >= 1.42) { frames = 5; enter(kind === 1 ? "deny" : "pulse"); }
      break;
    }
    case "pulse": {
      relay = pt < 0.5;
      if (pt >= 0.5) { relay = false; enter("open"); }
      break;
    }
    case "open": {
      const t = clamp(pt / 0.85, 0, 1);
      angle = ARM_OPEN * ease(t);
      if (t >= 1) enter("pass");
      break;
    }
    case "pass": {
      const t = clamp(pt / 1.1, 0, 1);
      y = lerp(BIKE_STOP, 8, ease(t));
      if (t >= 1) enter("exit");
      break;
    }
    case "exit": {
      const t = clamp(pt / 1.6, 0, 1);
      y = lerp(8, BIKE_EXIT, ease(t));
      angle = ARM_OPEN * (1 - ease(clamp((pt - 1.05) / 0.55, 0, 1)));
      if (t >= 1) enter("fade");
      break;
    }
    case "fade": {
      opacity = 1 - clamp(pt / 0.4, 0, 1);
      if (pt >= 0.4) { y = BIKE_START; opacity = 0; enter("appear"); }
      break;
    }
    case "appear": {
      opacity = clamp(pt / 0.45, 0, 1);
      if (pt >= 0.45) { opacity = 1; enter("idle"); }
      break;
    }
    case "deny": {
      if (pt >= 3) enter("reverse");
      break;
    }
    case "reverse": {
      const t = clamp(pt / 1.4, 0, 1);
      y = lerp(BIKE_STOP, BIKE_START, ease(t));
      if (t >= 1) enter("idle");
      break;
    }
    case "idle": {
      if (pt >= 0.9) { pass++; cycle(pass % 2); }
      break;
    }
  }
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  step(dt);
  draw();
  const settled = !visible || (!dragging && phase === "idle" && false);
  frame = visible && !settled ? requestAnimationFrame(tick) : 0;
}
function run() {
  if (record) return;
  if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); }
}
new IntersectionObserver((entries) => {
  visible = entries[entries.length - 1].isIntersecting;
  if (visible) run(); else if (frame) { cancelAnimationFrame(frame); frame = 0; }
}, { rootMargin: "120px 0px" }).observe(stage);
function yAt(event) {
  const box = svg.getBoundingClientRect();
  const px = ((event.clientX - box.left) / box.width) * WIDTH;
  const py = ((event.clientY - box.top) / box.height) * HEIGHT;
  const dx = laneB[0] - laneA[0], dy = laneB[1] - laneA[1];
  const t = clamp(((px - laneA[0]) * dx + (py - laneA[1]) * dy) / (dx * dx + dy * dy), 0, 1);
  return lerp(BIKE_START, BIKE_EXIT, t);
}
stage.addEventListener("pointerdown", (event) => {
  if (!event.target.closest('[data-part="bike"]')) return;
  dragging = true;
  phase = "manual"; pt = 0; angle = 0; relay = false; frames = 0; opacity = 1;
  y = clamp(yAt(event), BIKE_EXIT, BIKE_START);
  stage.setPointerCapture(event.pointerId);
  stage.focus({ preventScroll: true });
  run();
});
stage.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  y = clamp(yAt(event), BIKE_EXIT, BIKE_START);
});
stage.addEventListener("pointerup", (event) => {
  if (!dragging) return;
  dragging = false;
  try { stage.releasePointerCapture(event.pointerId); } catch (error) {}
  if (Math.abs(y - BIKE_STOP) < 2) { y = BIKE_STOP; frames = 0; enter("scan"); }
  else { approachFrom = y; frames = 0; enter("approach"); }
  run();
});
stage.addEventListener("pointercancel", () => { dragging = false; });
stage.addEventListener("keydown", (event) => {
  if (event.code !== "Space" && event.key !== " ") return;
  event.preventDefault();
  if (still.matches) {
    angle = angle > 0.1 ? 0 : ARM_OPEN;
    frames = angle > 0.1 ? 5 : 3;
    y = BIKE_STOP; opacity = 1; relay = false;
    enter("still");
    draw();
    return;
  }
  pass = 0;
  cycle(0);
});
if (still.matches) {
  angle = 0; frames = 3; y = BIKE_STOP;
  enter("still");
}
draw();
if (!still.matches) run();

if (record) {
  window.__gerbang = {
    step,
    draw,
    cycle,
    stop() { if (frame) cancelAnimationFrame(frame); frame = 0; },
  };
}
`;

const body =
  css +
  k.plateHtml({
    fig: "Gambar 1",
    title: "Gerbang masuk",
    hint: "Seret motor · tekan Spasi",
    readout: "memindai · 3/5 frame",
    keys: [
      { mark: "lit", label: "Lengan palang, beacon, dan LED relay yang bergerak" },
      { mark: "raised", label: "Kamera Module V3, sensor IR, dan layar info" },
      { mark: "dim", label: "Raspberry Pi 5, modul relay, dan catu daya di dalam kabinet" },
    ],
    caption:
      "Gerbang masuk parkir kampus yang dikendalikan Raspberry Pi 5. Satu sepeda motor dan satu pengendara berhenti dengan roda depan di garis; kamera menyalurkan 15 fps pada 960×720 dan memindai plat nomor di belakang motor. Setelah lima frame stabil relay memberi pulsa 0,5 detik untuk membuka palang. Sensor IR menjaga lengan tetap terbuka selama motor masih berada di bawahnya, dengan batas 2 detik dan cadangan 5 detik; kegagalan mengenali plat memicu reset 3 detik. Seret motor di lajur atau tekan Spasi untuk mengirim satu motor.",
    body: `<div class="iso-stage" tabindex="0" role="group" aria-label="Gerbang masuk parkir. Seret motor di lajur atau tekan Spasi untuk mengirim satu motor.">${svg}<span class="pg-sr" role="status" aria-live="polite" data-status></span></div>`,
  });

const name = theme === "light" ? "gerbang-masuk-light.html" : "gerbang-masuk.html";
const ROOT = join(HERE, "..");
const OUT = join(ROOT, "docs", "demo");
mkdirSync(OUT, { recursive: true });
const html = k.pageHtml({ title: "Gerbang masuk parkir", theme, body, script: kitScript() + live, width: 720 })
  .replace('<html lang="en">', '<html lang="id">');
writeFileSync(join(OUT, name), html);
console.log("wrote", `docs/demo/${name}`);
