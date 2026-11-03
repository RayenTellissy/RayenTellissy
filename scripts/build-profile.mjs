#!/usr/bin/env node
// Generates assets/profile.svg, assets/profile-narrow.svg and README.md: a dot-field profile page as self-contained SVGs.
// GitHub READMEs can't run scripts or load fonts, so text is outlined and the light is animated with SMIL.
// Edit COPY, then run: node scripts/build-profile.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const COPY = {
  name: 'Ryan Tellissy',
  bio: 'Lead Software Engineer at Voyagr Inc.',
  work: [
    ['Web', 'Products and platforms, front to back.'],
    ['Mobile', 'iOS and Android apps.'],
    ['Desktop', 'Native apps for macOS and Windows.'],
  ],
  footer: 'ryantellissy.com  ·  LinkedIn',
  // Real links, below the image: text inside an image can't be clicked.
  links: [
    ['Website', 'https://www.ryantellissy.com/'],
    ['LinkedIn', 'https://www.linkedin.com/in/ryantellissy/'],
  ],
  rawAssets: 'https://raw.githubusercontent.com/RayenTellissy/RayenTellissy/main/assets',
};

const LAYOUTS = {
  'profile.svg': {
    width: 1000,
    fieldRows: 40,
    labelWidth: 112,
    type: { name: 50, bio: 19, work: 19, workLeading: 34, footer: 16 },
  },
  'profile-narrow.svg': {
    width: 560,
    fieldRows: 34,
    labelWidth: 112,
    type: { name: 44, bio: 20, work: 21, workLeading: 38, footer: 20 },
  },
};

const PITCH = 10;
const MAX_DOT_RADIUS = 3.6;

const INK = {
  name: { fill: '#fff', weight: 0.7 },
  bio: { fill: '#bdbdbd' },
  label: { fill: '#f5f5f5', weight: 0.3 },
  work: { fill: '#a8a8a8' },
  footer: { fill: '#d8d8d8' },
};

const fonts = JSON.parse(readFileSync(new URL('./glyphs.json', import.meta.url)));
const round = (value) => String(+value.toFixed(2));

function glyphFor(font, char) {
  const glyph = fonts[font].glyphs[char];
  if (!glyph) throw new Error(`No outline for ${JSON.stringify(char)} in scripts/glyphs.json`);
  return glyph;
}

function measure(text, font, size) {
  const { upem, kern } = fonts[font];
  let width = 0;
  const chars = [...text];
  chars.forEach((char, i) => {
    width += glyphFor(font, char).a + (kern[char + chars[i + 1]] || 0);
  });
  return (width * size) / upem;
}

const compact = (values) =>
  values
    .map((value) => round(value).replace(/^(-?)0\./, '$1.'))
    .join(' ')
    .replace(/ -/g, '-');

// A glyph as relative commands: repeated letters become repeated strings, which gzip almost entirely away.
const outlines = new Map();
function outline(font, char, size) {
  const key = `${font}:${char}:${size}`;
  if (outlines.has(key)) return outlines.get(key);
  const scale = size / fonts[font].upem;
  let current = [0, 0];
  let start = [0, 0];
  let first = null;
  let tail = '';
  for (const [, command, args] of glyphFor(font, char).d.matchAll(/([MLQCZ])([^MLQCZ]*)/g)) {
    if (command === 'Z') {
      tail += 'z';
      current = start;
      continue;
    }
    const numbers = args.trim().split(/[ ,]+/).map(Number);
    const deltas = numbers.map((value, i) => (i % 2 ? current[1] - value : value - current[0]) * scale);
    const end = numbers.slice(-2);
    if (command === 'M') {
      start = end;
      if (first) tail += `m${compact(deltas)}`;
      else first = end;
    } else {
      tail += command.toLowerCase() + compact(deltas);
    }
    current = end;
  }
  const result = { first, tail };
  outlines.set(key, result);
  return result;
}

// Collects outlined text by style, so each style becomes a single path.
function createInk() {
  const paths = {};
  return {
    put(style, text, x, baseline, font, size, align = 'left') {
      const { upem, glyphs, kern } = fonts[font];
      const scale = size / upem;
      let pen = align === 'center' ? x - measure(text, font, size) / 2 : x;
      const chars = [...text];
      chars.forEach((char, i) => {
        const { first, tail } = outline(font, char, size);
        if (first) {
          paths[style] = `${paths[style] || ''}M${compact([pen + first[0] * scale, baseline - first[1] * scale])}${tail}`;
        }
        pen += (glyphs[char].a + (kern[char + chars[i + 1]] || 0)) * scale;
      });
    },
    svg() {
      return Object.entries(paths)
        .map(([style, d]) => {
          const { fill, weight } = INK[style];
          const stroke = weight ? ` stroke="${fill}" stroke-width="${weight}"` : '';
          return `<path d="${d}" fill="${fill}"${stroke}/>`;
        })
        .join('');
    },
  };
}

// Deterministic randomness, so rebuilding only changes what COPY or LAYOUTS changed.
function createRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

// A dot tile with a different radius per dot. The tile sides are coprime so repeats are hard to spot.
function dotTile(id, columns, rows, minRadius, maxRadius, random) {
  let d = '';
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const r = minRadius + random() ** 1.4 * (maxRadius - minRadius);
      const cx = (column + 0.5) * PITCH;
      const cy = (row + 0.5) * PITCH;
      d += `M${round(cx - r)} ${cy}a${round(r)} ${round(r)} 0 1 0 ${round(2 * r)} 0a${round(r)} ${round(r)} 0 1 0 ${round(-2 * r)} 0Z`;
    }
  }
  return (
    `<pattern id="${id}" width="${columns * PITCH}" height="${rows * PITCH}" patternUnits="userSpaceOnUse">` +
    `<path d="${d}" fill="#fff"/></pattern>`
  );
}

// Wavelength is relative to the image width; center, amplitude, thickness and bob to the height of the field.
const RIBBONS = [
  { id: 'waveA', peak: 0.95, wavelength: 0.62, center: 0.28, amplitude: 0.16, twist: 0.8, thickness: 0.26, seconds: 8, direction: 1, bob: 0.05, bobSeconds: 7 },
  { id: 'waveB', peak: 0.75, wavelength: 0.86, center: 0.52, amplitude: 0.2, twist: 2.6, thickness: 0.22, seconds: 12, direction: -1, bob: 0.06, bobSeconds: 9 },
  { id: 'waveC', peak: 0.85, wavelength: 0.5, center: 0.76, amplitude: 0.12, twist: 4.1, thickness: 0.2, seconds: 7, direction: 1, bob: 0.04, bobSeconds: 6 },
];

// Stacked strokes fade a ribbon's edges without a blur filter, which would have to re-run on every frame.
const SOFT_EDGE = [0.875, 0.75, 0.625, 0.5, 0.375, 0.25, 0.125];
const CORE = SOFT_EDGE.slice(3);

// Per-stroke opacities that composite to a bell-shaped falloff, so no single stroke edge shows across a dot.
function strokeOpacities(scales, peak) {
  const edge = scales[0] + scales[0] - scales[1];
  let lit = 0;
  return scales.map((scale) => {
    const target = peak * (1 - (scale / edge) ** 2) ** 2;
    const opacity = 1 - (1 - target) / (1 - lit);
    lit = target;
    return opacity;
  });
}

// A wave with a second harmonic, so it undulates unevenly but still repeats exactly every wavelength.
function wavePath({ id, wavelength, center, amplitude, twist, direction }, width, top, height) {
  const period = Math.round(wavelength * width);
  const step = 16;
  const overhang = step * 2;
  const start = direction > 0 ? -period - overhang : -overhang;
  const count = Math.ceil((width + period + overhang * 2) / step);
  const waveY = (x) => {
    const phase = (2 * Math.PI * x) / period;
    return Math.round(top + height * (center + amplitude * (0.72 * Math.sin(phase) + 0.28 * Math.sin(2 * phase + twist))));
  };
  let y = waveY(start);
  let d = `M${start} ${y}`;
  for (let i = 1; i <= count; i++) {
    const next = waveY(start + i * step);
    d += `l${step} ${next - y}`;
    y = next;
  }
  return `<path id="${id}" d="${d}" fill="none"/>`;
}

// Slides by exactly one wavelength per loop, so it never visibly restarts, while bobbing up and down.
function ribbon({ id, peak, wavelength, thickness, seconds, direction, bob, bobSeconds }, strokes, width, height) {
  const opacities = strokeOpacities(strokes, peak);
  const reach = round(bob * height);
  const ease = '.45 0 .55 1';
  const uses = strokes
    .map((scale, i) => `<use href="#${id}" stroke="#fff" stroke-opacity="${round(opacities[i])}" stroke-width="${round(scale * thickness * height)}"/>`)
    .join('');
  return (
    `<g><animateTransform attributeName="transform" type="translate" values="0 ${-reach};0 ${reach};0 ${-reach}" keyTimes="0;.5;1" calcMode="spline" keySplines="${ease};${ease}" dur="${bobSeconds}s" repeatCount="indefinite"/>` +
    `<g><animateTransform attributeName="transform" type="translate" from="0 0" to="${direction * Math.round(wavelength * width)} 0" dur="${seconds}s" repeatCount="indefinite"/>${uses}</g></g>`
  );
}

// Uneven top edge for the field: black paint above each column, plus a few knocked-out dots near the edge.
function skyline(width, fieldTop, random) {
  const columns = Math.ceil(width / PITCH);
  let d = `M0 0V${fieldTop}`;
  let holes = '';
  for (let column = 0; column < columns; column++) {
    const rise = random() < 0.35 ? Math.floor(random() * 4) : 0;
    const top = fieldTop - rise * PITCH;
    d += `V${top}H${(column + 1) * PITCH}`;
    for (let row = 0; row < 5; row++) {
      if (random() < 0.34 - row * 0.06) {
        holes += `M${column * PITCH} ${top + row * PITCH}h${PITCH}v${PITCH}h${-PITCH}Z`;
      }
    }
  }
  return `<path d="${d}V0Z${holes}" fill="#000"/>`;
}

// The image's text for screen readers and search, since outlined text can't be read or selected.
function description() {
  return [`${COPY.name}.`, COPY.bio, ...COPY.work.map(([label, text]) => `${label}: ${text}`)]
    .join(' ')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function readme() {
  const links = COPY.links.map(([text, url]) => `[${text}](${url})`).join(' · ');
  return `<a href="${COPY.links[0][1]}">
  <picture>
    <source media="(max-width: 600px)" srcset="${COPY.rawAssets}/profile-narrow.svg">
    <img src="./assets/profile.svg" width="100%" alt="${description()}">
  </picture>
</a>

<div align="center">

${links}

</div>
`;
}

function build({ width, fieldRows, labelWidth, type }) {
  const ink = createInk();
  const random = createRandom(7);
  const center = width / 2;

  const nameBaseline = 92;
  ink.put('name', COPY.name, center, nameBaseline, 'sans', type.name, 'center');
  ink.put('bio', COPY.bio, center, nameBaseline + type.bio * 1.9, 'sans', type.bio, 'center');

  // Label and text rows, centred as one block.
  const widest = Math.max(...COPY.work.map(([, text]) => measure(text, 'sans', type.work)));
  const workX = (width - labelWidth - widest) / 2;
  const workTop = nameBaseline + type.bio * 1.9 + 62;
  COPY.work.forEach(([label, text], i) => {
    const baseline = workTop + i * type.workLeading;
    ink.put('label', label, workX, baseline, 'sans', type.work);
    ink.put('work', text, workX + labelWidth, baseline, 'sans', type.work);
  });

  // Dot field, with a gap near the bottom that holds the links line.
  const fieldTop = Math.ceil((workTop + (COPY.work.length - 1) * type.workLeading + 74) / PITCH) * PITCH;
  const gapTop = fieldTop + fieldRows * PITCH;
  const gapHeight = PITCH * 6;
  const height = gapTop + gapHeight + PITCH * 3;
  const fieldHeight = height - fieldTop;
  const field = `x="0" y="${fieldTop}" width="${width}" height="${fieldHeight}"`;
  ink.put('footer', COPY.footer, center, gapTop + gapHeight / 2 + type.footer * 0.36, 'mono', type.footer, 'center');

  const defs =
    `<clipPath id="card"><rect width="${width}" height="${height}" rx="16"/></clipPath>` +
    dotTile('medium', 17, 13, 1.5, 2.4, random) +
    dotTile('large', 19, 11, 2.7, MAX_DOT_RADIUS, random) +
    dotTile('small', 1, 1, 1.25, 1.25, random) +
    `<mask id="dots" maskUnits="userSpaceOnUse" ${field}><rect ${field} fill="url(#medium)"/></mask>` +
    `<mask id="swell" maskUnits="userSpaceOnUse" ${field}><rect ${field} fill="url(#large)"/></mask>` +
    RIBBONS.map((wave) => wavePath(wave, width, fieldTop, fieldRows * PITCH)).join('') +
    `<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset=".7" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".95"/></linearGradient>` +
    `<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#000" stop-opacity=".3"/><stop offset=".5" stop-color="#000" stop-opacity=".1"/><stop offset=".8" stop-color="#000" stop-opacity="0"/></linearGradient>`;

  const ribbons = (strokes) => RIBBONS.map((wave) => ribbon(wave, strokes, width, fieldRows * PITCH)).join('');

  // The middle of each ribbon also lights the larger dots, so a dot looks like it swells as a wave passes over it.
  const light =
    `<g mask="url(#dots)">` +
    `<rect ${field} fill="#fff" fill-opacity=".14"/>` +
    `<g class="live">${ribbons(SOFT_EDGE)}</g>` +
    `<rect ${field} fill="url(#floor)"/></g>` +
    `<g class="live" mask="url(#swell)">${ribbons(CORE)}</g>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${description()}">` +
    `<title>${COPY.name}</title>` +
    `<style>@media (prefers-reduced-motion:reduce){.live{display:none}}</style>` +
    `<defs>${defs}</defs>` +
    `<g clip-path="url(#card)"><rect width="${width}" height="${height}" fill="#000"/>` +
    light +
    `<rect ${field} fill="url(#small)" fill-opacity=".4"/>` +
    `<rect ${field} fill="url(#fade)"/>` +
    skyline(width, fieldTop, random) +
    // Reaches the top of the next row's largest dot: Safari shifts pattern tiles enough for the row above to peek through.
    `<rect x="0" y="${gapTop}" width="${width}" height="${gapHeight + PITCH / 2 - MAX_DOT_RADIUS}" fill="#000"/>` +
    ink.svg() +
    `</g></svg>\n`
  );
}

const outDir = new URL('../assets/', import.meta.url);
mkdirSync(outDir, { recursive: true });
for (const [file, layout] of Object.entries(LAYOUTS)) {
  const svg = build(layout);
  writeFileSync(new URL(file, outDir), svg);
  const size = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  console.log(`assets/${file}: ${size[1]}x${size[2]}, ${(svg.length / 1024).toFixed(0)} KB`);
}
writeFileSync(new URL('../README.md', import.meta.url), readme());
console.log('README.md');
