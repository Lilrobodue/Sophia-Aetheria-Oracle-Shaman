// Generate PWA icon PNGs for Sophia Oracle
// Run: node generate-icons.js
// Creates icons/icon-192.png, icons/icon-512.png, etc.

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const ICONS_DIR = path.join(__dirname, 'icons');
if (!fs.existsSync(ICONS_DIR)) fs.mkdirSync(ICONS_DIR);

function drawIcon(size, maskable = false) {
    const c = createCanvas(size, size);
    const ctx = c.getContext('2d');
    const s = size / 64; // scale from 64px base

    // Background
    const bgR = size * 0.22;
    ctx.fillStyle = '#0a0a0f';
    if (maskable) {
        // Maskable icons: fill entire rect, no rounded corners
        ctx.fillRect(0, 0, size, size);
    } else {
        ctx.beginPath();
        ctx.roundRect(0, 0, size, size, bgR);
        ctx.fill();
    }

    // Subtle radial glow behind crystal ball
    const cx = size / 2, cy = size * 0.42, r = size * 0.25;
    const glowGrad = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r * 2);
    glowGrad.addColorStop(0, 'rgba(123, 80, 212, 0.25)');
    glowGrad.addColorStop(0.5, 'rgba(255, 0, 85, 0.08)');
    glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, 0, size, size);

    // Crystal ball — main sphere with gradient
    const ballGrad = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.3, r * 0.1, cx, cy, r);
    ballGrad.addColorStop(0, '#c4a0ff');
    ballGrad.addColorStop(0.3, '#9B6FE8');
    ballGrad.addColorStop(0.6, '#7B50D4');
    ballGrad.addColorStop(1, '#2a1050');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = ballGrad;
    ctx.fill();

    // Glass highlight (top-left shine)
    const shineGrad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.05, cx - r * 0.2, cy - r * 0.2, r * 0.5);
    shineGrad.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
    shineGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.15)');
    shineGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.95, 0, Math.PI * 2);
    ctx.fillStyle = shineGrad;
    ctx.fill();

    // Inner glow — mystical energy
    const innerGlow = ctx.createRadialGradient(cx, cy + r * 0.2, r * 0.05, cx, cy, r * 0.7);
    innerGlow.addColorStop(0, 'rgba(255, 0, 85, 0.3)');
    innerGlow.addColorStop(0.5, 'rgba(196, 160, 255, 0.1)');
    innerGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
    ctx.fillStyle = innerGlow;
    ctx.fill();

    // Sphere rim — subtle pink glow
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 0, 85, 0.4)';
    ctx.lineWidth = s * 1.5;
    ctx.stroke();

    // Outer ethereal ring
    ctx.beginPath();
    ctx.arc(cx, cy, r + s * 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(196, 160, 255, 0.15)';
    ctx.lineWidth = s * 1;
    ctx.stroke();

    // Base / stand
    const baseY = cy + r + s * 2;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.8, baseY);
    ctx.quadraticCurveTo(cx - r * 0.9, baseY + s * 5, cx - r * 0.95, baseY + s * 8);
    ctx.lineTo(cx + r * 0.95, baseY + s * 8);
    ctx.quadraticCurveTo(cx + r * 0.9, baseY + s * 5, cx + r * 0.8, baseY);
    ctx.closePath();
    const baseGrad = ctx.createLinearGradient(cx, baseY, cx, baseY + s * 8);
    baseGrad.addColorStop(0, 'rgba(255, 0, 85, 0.35)');
    baseGrad.addColorStop(1, 'rgba(255, 0, 85, 0.1)');
    ctx.fillStyle = baseGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 0, 85, 0.3)';
    ctx.lineWidth = s * 0.5;
    ctx.stroke();

    // Small stars / sparkles
    const stars = [
        { x: cx - r * 1.4, y: cy - r * 0.8, s: 2 },
        { x: cx + r * 1.3, y: cy - r * 0.6, s: 1.5 },
        { x: cx - r * 1.1, y: cy + r * 0.4, s: 1 },
        { x: cx + r * 1.5, y: cy + r * 0.2, s: 1.8 },
        { x: cx + r * 0.5, y: cy - r * 1.5, s: 1.2 },
    ];
    stars.forEach(star => {
        ctx.beginPath();
        ctx.arc(star.x, star.y, s * star.s, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(196, 160, 255, ${0.3 + Math.random() * 0.3})`;
        ctx.fill();
    });

    return c;
}

// Generate all icon variants
const configs = [
    { size: 192, file: 'icon-192.png', maskable: false },
    { size: 512, file: 'icon-512.png', maskable: false },
    { size: 192, file: 'icon-maskable-192.png', maskable: true },
    { size: 512, file: 'icon-maskable-512.png', maskable: true },
];

configs.forEach(({ size, file, maskable }) => {
    const canvas = drawIcon(size, maskable);
    const buffer = canvas.toBuffer('image/png');
    const outPath = path.join(ICONS_DIR, file);
    fs.writeFileSync(outPath, buffer);
    console.log(`✅ Generated ${outPath} (${(buffer.length / 1024).toFixed(1)} KB)`);
});

console.log('\n📲 All PWA icons generated! Commit the icons/ folder.');
