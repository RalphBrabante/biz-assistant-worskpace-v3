const { rgb } = require('pdf-lib');

// Measured cell centers in the official templates, in points from the top left.
// Grey separator cells on page one are deliberately excluded. Page two uses
// continuous cells. Do not paint over the borders or lower alignment ticks.
const TIN_LAYOUTS = {
  '1701Q': [
    { centers: [205.67, 220.01, 234.53, 263.75, 278.09, 292.49, 321.42, 335.83, 350.17, 379.57, 394.51, 409.45, 424.51, 439.45], top: 128.5, eraseBranch: true, eraseBounds: [127.74, 141.22] },
    { centers: [20.04, 33.3, 46.62, 60.01, 73.46, 86.9, 100.34, 113.78, 127.22, 141.26, 155.96, 170.66, 185.36, 200.07], top: 101, eraseBranch: true, eraseBounds: [100, 114.4] },
  ],
  '1702Q': [
    { centers: [222.71, 237.89, 253.01, 283.37, 298.49, 313.67, 343.99, 359.17, 374.35, 404.59, 419.77, 434.95, 450.13, 465.325], top: 181, eraseBranch: true, eraseBounds: [179.7, 194.3] },
    { centers: [25.62, 40.86, 56.05, 71.24, 86.48, 101.72, 116.9, 132.08, 147.26, 162.38, 177.56, 192.755, 207.89, 223.07], top: 94, eraseBranch: true, eraseBounds: [92.8, 109] },
  ],
  '2550Q': [
    { centers: [240.35, 254.45, 268.58, 297.25, 311.55, 325.73, 354.27, 368.53, 382.80, 411.73, 425.93, 440.08, 454.28, 468.45], top: 171.4, eraseBranch: true, eraseBounds: [170.4, 184.6] },
    { centers: [29.5, 43.25, 57.35, 71.46, 85.575, 99.62, 113.67, 127.775, 141.88, 155.98, 170.13, 184.28, 198.38, 212.515], top: 92.2, eraseBranch: true, eraseBounds: [91.6, 105.4] },
  ],
  '2551Q': [
    { centers: [228, 242.1, 256.2, 284.75, 298.85, 313.01, 341.59, 355.63, 369.85, 398.35, 412.45, 426.67, 440.83, 455], top: 163.1 },
    { centers: [30.48, 44.28, 58.45, 72.68, 86.84, 101, 115.22, 129.38, 143.54, 157.7, 171.86, 186.08, 200.255, 214.43], top: 111.2 },
  ],
};

function drawTin(page, font, tin, layout) {
  if (!/^\d{14}$/.test(tin) || layout.centers.length !== 14) throw new Error('Expected a normalized 14-digit BIR TIN.');
  const size = 10;
  for (let i = 0; i < tin.length; i++) {
    const center = layout.centers[i];
    if (layout.eraseBranch && i >= 9) {
      const [eraseTop, eraseBottom] = layout.eraseBounds;
      page.drawRectangle({ x: center - 5.5, y: page.getHeight() - eraseBottom,
        width: 11, height: eraseBottom - eraseTop, color: rgb(1, 1, 1) });
    }
    page.drawText(tin[i], { x: center - font.widthOfTextAtSize(tin[i], size) / 2,
      y: page.getHeight() - layout.top - size, size, font, color: rgb(0, 0, 0) });
  }
}

module.exports = { drawTin, TIN_LAYOUTS };
