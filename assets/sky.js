// Shared behavior for the "sky" pages (home, music):
//  - sizes the night photo and finds the horizon
//  - scatters every .float item across the sky with a random size, tilt and
//    3D edge depth
//  - draws slow water ripples over the photo (WebGL) and moves each letter
//    of the sky text with the same waves
//  - lays moving TV-static grain over everything
//  - fills in the copyright year and the click-to-reveal email links
(function () {
    // Resolve site-root paths from this script's own location, so pages at
    // any depth can share it.
    const ROOT = new URL("../", document.currentScript.src);
    const BG_SRC = new URL("images/bg.jpg", ROOT).href;

    const IMG_W = 2976, IMG_H = 3968;
    const HORIZON = 0.455; // horizon as a fraction of image height
    const POS_Y = 0.5;     // matches background-position y
    const ZOOM = 0.82;     // 1 = fill the screen (cover); lower = zoomed out

    // ---------------------------------------------------------------------
    // Photo layout: where the photo is drawn on screen, in CSS px. Shared by
    // the CSS fallback, the edge feathering, the sky bounds and the ripple.
    // ---------------------------------------------------------------------
    const layout = {};

    function computeLayout() {
        const vw = window.innerWidth, vh = window.innerHeight;
        const cover = Math.max(vw / IMG_W, vh / IMG_H);
        const contain = Math.min(vw / IMG_W, vh / IMG_H);
        const scale = Math.max(cover * ZOOM, contain);
        const w = IMG_W * scale, h = IMG_H * scale;
        Object.assign(layout, { vw, vh, w, h, x: (vw - w) / 2, y: (vh - h) * POS_Y });

        const root = document.documentElement.style;
        root.setProperty("--bg-size", `${w}px ${h}px`);

        // Fade only the photo's edges that land on screen; edges that run
        // off-screen are pushed out so they never fade.
        const { x, y } = layout;
        document.querySelectorAll(".photo").forEach(el => {
            el.style.setProperty("--l", x > 0.5 ? `${x}px` : "-999px");
            el.style.setProperty("--r", x > 0.5 ? `${x + w}px` : `${vw + 999}px`);
            el.style.setProperty("--t", y > 0.5 ? `${y}px` : "-999px");
            el.style.setProperty("--b", y > 0.5 ? `${y + h}px` : `${vh + 999}px`);
        });

        // The sky ends just above the horizon.
        const horizonY = y + h * HORIZON;
        root.setProperty("--horizon-gap", Math.max(0, vh - horizonY) + "px");
    }

    computeLayout();
    window.addEventListener("resize", computeLayout);

    // ---------------------------------------------------------------------
    // Scatter: every .float lands somewhere random in the sky with a random
    // size, a few degrees of tilt and a random 3D edge depth, without
    // overlapping. A fresh layout is drawn on each load; resizes keep the
    // same picks unless the width changes (e.g. rotating a phone).
    // ---------------------------------------------------------------------
    const rand = (lo, hi) => lo + Math.random() * (hi - lo);
    let picks = null, pickedWidth = null;

    // A solid 3D edge `px` deep, out of as few shadows as possible. Each
    // drop-shadow copies everything drawn so far (letters plus earlier
    // shadows), so doubling offsets (1, 2, 4, 8...) fill a gapless edge: 15px
    // takes 4 layers instead of 15. Offsets are whole pixels because
    // browsers round sub-pixel ones away.
    function extrude(px) {
        const layers = [];
        let covered = 0, step = 1;
        while (covered < px) {
            const o = Math.min(step, px - covered);
            layers.push(`drop-shadow(${o}px ${o}px 0 var(--depth))`);
            covered += o;
            step *= 2;
        }
        return layers.join(" ");
    }

    function scatter() {
        const sky = document.querySelector(".sky");
        const items = [...document.querySelectorAll(".float")];
        if (!sky || !items.length) return;
        document.body.classList.add("scattered");

        const vmin = Math.min(window.innerWidth, window.innerHeight);
        // Shrink the size range a little when there are more items to fit.
        const crowd = Math.min(1, Math.sqrt(4 / items.length));
        const maxSize = Math.max(22, Math.min(46, vmin * 0.075)) * crowd;
        const minSize = Math.max(13, 14 * crowd);

        if (!picks || picks.length !== items.length || pickedWidth !== window.innerWidth) {
            picks = items.map(() => ({
                size: rand(minSize, Math.max(minSize + 4, maxSize)),
                angle: rand(-7, 7),
                // 3D edge depth as a fraction of the text size: always clearly
                // visible (at least 0.12em), and squaring the random number
                // makes an occasional roll deeper (up to 0.35em).
                depth: 0.12 + Math.random() ** 2 * 0.23,
                pos: null,
            }));
            pickedWidth = window.innerWidth;
        }

        const box = sky.getBoundingClientRect();
        const placed = [];
        // Clearance between items: breathing room, plus the ripple's wobble
        // (letters move up to ~7px) so neighbors never touch mid-wave.
        const gap = 22;

        const overlaps = (x, y, w, h) => placed.some(b =>
            x < b.x + b.w + gap && x + w + gap > b.x &&
            y < b.y + b.h + gap && y + h + gap > b.y);

        // Apply an item's size, 3D edge and tilt; return its footprint.
        function style(el, pick) {
            el.style.left = el.style.top = "0px";
            el.style.fontSize = `${pick.size}px`;
            let edge = 0, halo = 0;
            el.querySelectorAll(".t").forEach(t => {
                const fs = parseFloat(getComputedStyle(t).fontSize);
                const px = Math.max(4, Math.round(fs * pick.depth));
                // Links also get a soft white halo around the whole block.
                const glow = t.matches("a") ? fs * 0.35 : 0;
                t.style.filter = extrude(px) +
                    (glow ? ` drop-shadow(0 0 ${glow.toFixed(1)}px rgba(255, 255, 255, 0.3))` : "");
                edge = Math.max(edge, px);
                halo = Math.max(halo, glow * 0.5);
            });
            el.style.transform = `rotate(${pick.angle.toFixed(2)}deg)`;
            // Measure the tilted box at the sky's corner. The footprint adds
            // the 3D edge (it sticks out down-right) and part of the halo.
            const r = el.getBoundingClientRect();
            return { r, w: r.width + edge + halo * 2, h: r.height + edge + halo * 2, pad: halo };
        }

        // Place the biggest items first: they're the hardest to fit.
        const order = items.map((el, i) => i).sort((a, b) => picks[b].size - picks[a].size);
        for (const i of order) {
            const el = items[i], pick = picks[i];
            let spot = null, f;
            // Look for a free spot; if the sky is too crowded, shrink the
            // item a little and look again rather than allowing an overlap.
            for (let attempt = 0; attempt < 12 && !spot; attempt++) {
                f = style(el, pick);
                const maxX = Math.max(0, box.width - f.w);
                const maxY = Math.max(0, box.height - f.h);
                for (let tries = 0; tries < 300; tries++) {
                    const reuse = pick.pos && attempt === 0 && tries === 0;
                    const x = box.left + (reuse ? pick.pos.fx : Math.random()) * maxX;
                    const y = box.top + (reuse ? pick.pos.fy : Math.random()) * maxY;
                    if (!overlaps(x, y, f.w, f.h)) {
                        spot = { x, y, maxX, maxY };
                        break;
                    }
                }
                if (!spot) pick.size = Math.max(10, pick.size * 0.88);
            }
            if (!spot) spot = { x: box.left, y: box.top, maxX: 0, maxY: 0 }; // practically unreachable
            placed.push({ x: spot.x, y: spot.y, w: f.w, h: f.h });
            pick.pos = {
                fx: spot.maxX ? (spot.x - box.left) / spot.maxX : 0,
                fy: spot.maxY ? (spot.y - box.top) / spot.maxY : 0,
            };
            el.style.left = `${spot.x + f.pad - f.r.left}px`;
            el.style.top = `${spot.y + f.pad - f.r.top}px`;
        }
        document.dispatchEvent(new Event("skyplaced"));
    }

    scatter();
    window.addEventListener("resize", scatter);
    if (document.fonts) document.fonts.ready.then(scatter);

    // ---------------------------------------------------------------------
    // Grain: moving TV static over the whole page. A handful of small noise
    // tiles are drawn once; each tick shows a random one at a random offset,
    // so the static crawls without redrawing noise every frame.
    // ---------------------------------------------------------------------
    (function grain() {
        const TILE = 160;        // noise tile size in CSS px
        const FRAMES = 6;        // distinct noise tiles to cycle through
        const FPS = 20;          // how often the static jumps
        const ALPHA = [8, 23];   // per-speck opacity range (0-255): grain strength

        const layer = document.createElement("div");
        layer.className = "grain";
        layer.setAttribute("aria-hidden", "true");
        document.body.appendChild(layer);

        const tiles = [];
        for (let f = 0; f < FRAMES; f++) {
            const c = document.createElement("canvas");
            c.width = c.height = TILE;
            const ctx = c.getContext("2d");
            const img = ctx.createImageData(TILE, TILE);
            const d = img.data;
            for (let i = 0; i < d.length; i += 4) {
                const v = Math.random() * 255;
                d[i] = d[i + 1] = d[i + 2] = v;
                d[i + 3] = ALPHA[0] + Math.random() * (ALPHA[1] - ALPHA[0]);
            }
            ctx.putImageData(img, 0, 0);
            tiles.push(`url(${c.toDataURL()})`);
        }

        function show() {
            layer.style.backgroundImage = tiles[(Math.random() * FRAMES) | 0];
            layer.style.backgroundPosition = `${(Math.random() * TILE) | 0}px ${(Math.random() * TILE) | 0}px`;
        }
        show();
        // Still grain for people who prefer reduced motion.
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

        let last = 0;
        (function tick(now) {
            if (now - last >= 1000 / FPS) {
                show();
                last = now;
            }
            requestAnimationFrame(tick);
        })(0);
    })();

    // ---------------------------------------------------------------------
    // Small bits
    // ---------------------------------------------------------------------

    // Keep the copyright year current (the HTML's year is the no-JS fallback).
    const year = document.getElementById("year");
    if (year) year.textContent = new Date().getFullYear();

    // Email is assembled only when clicked, so the address never appears in
    // the page source for spam scrapers to harvest.
    document.querySelectorAll(".js-mail").forEach(a => {
        a.addEventListener("click", e => {
            e.preventDefault();
            const user = ["moe", "elias"].join("");
            const host = ["gmail", "com"].join(".");
            window.location.href = "mail" + "to:" + user + "@" + host;
        });
    });

    // ---------------------------------------------------------------------
    // Ripple backdrop: slow, wide rings drawn entirely in a WebGL shader.
    // Rings spread from a few centers that drift around on their own. Each
    // ring fades in from nothing near its center, so there's no visible
    // focal point, and fades out with distance. The shader bends the photo
    // along the ring slopes like water. Falls back silently to the plain CSS
    // background.
    // ---------------------------------------------------------------------
    (function ripple() {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

        const canvas = document.querySelector(".ripple");
        if (!canvas) return;
        const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
        if (!gl) return;

        const WAVELENGTH = 150;  // px between rings; bigger = wider ripples
        const RING_SPEED = 28;   // px per second the rings travel outward
        const REFRACT = 7;       // max bend of the photo, in px
        const SHINE = 0.012;     // light catch on ring slopes
        const CLEAR = 220;       // radius (px) around each center left calm
        const REACH = 700;       // how far rings carry before fading out
        const DRIFT = 0.08;      // how fast the centers wander (slower than the rings)

        const VS = `
            attribute vec2 p;
            varying vec2 v;
            void main() {
                v = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); // y down
                gl_Position = vec4(p, 0.0, 1.0);
            }`;
        const FS = `
            #ifdef GL_FRAGMENT_PRECISION_HIGH
            precision highp float;
            #else
            precision mediump float;
            #endif
            varying vec2 v;
            uniform sampler2D img;
            uniform vec2 view;
            uniform vec4 rect;
            uniform vec2 centers[3];
            uniform float phase;   // already wrapped to 0..2pi
            uniform float k;       // 2pi / wavelength
            uniform float refract;
            uniform float shine;
            uniform float clearR;
            uniform float reach;

            void main() {
                vec2 px = v * view;
                vec2 g = vec2(0.0);
                for (int i = 0; i < 3; i++) {
                    vec2 d = px - centers[i];
                    float r = length(d) + 0.001;
                    float env = smoothstep(0.0, clearR, r) * exp(-r / reach);
                    g += (d / r) * env * cos(r * k - phase);
                }
                vec2 uv = (px + g * refract - rect.xy) / rect.zw;
                if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
                    gl_FragColor = vec4(0.0);
                    return;
                }
                vec3 c = texture2D(img, uv).rgb;
                c += (g.x * 0.7 - g.y) * shine;
                gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
            }`;

        function shader(type, src) {
            const sh = gl.createShader(type);
            gl.shaderSource(sh, src);
            gl.compileShader(sh);
            if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw gl.getShaderInfoLog(sh);
            return sh;
        }

        let prog;
        try {
            prog = gl.createProgram();
            gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
            gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
            gl.linkProgram(prog);
            if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
        } catch (e) {
            return;
        }
        gl.useProgram(prog);

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, "p");
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

        const u = name => gl.getUniformLocation(prog, name);
        const uView = u("view"), uRect = u("rect"), uCenters = u("centers"), uPhase = u("phase");
        const K = 2 * Math.PI / WAVELENGTH;
        gl.uniform1i(u("img"), 0);
        gl.uniform1f(u("k"), K);
        gl.uniform1f(u("refract"), REFRACT);
        gl.uniform1f(u("shine"), SHINE);
        gl.uniform1f(u("clearR"), CLEAR);
        gl.uniform1f(u("reach"), REACH);

        const tex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.round(layout.vw * dpr);
            canvas.height = Math.round(layout.vh * dpr);
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.uniform2f(uView, layout.vw, layout.vh);
            gl.uniform4f(uRect, layout.x, layout.y, layout.w, layout.h);
        }

        // Each center drifts on its own slow path (sums of sines with
        // unrelated frequencies, so the pattern never visibly repeats).
        const PATHS = [
            [0.71, 1.93, 0.53, 1.37, 0.0],
            [0.47, 1.21, 0.67, 1.71, 2.4],
            [0.59, 1.53, 0.41, 1.13, 4.1],
        ];
        const centers = new Float32Array(6);
        function placeCenters(t) {
            const left = Math.max(0, layout.x), right = Math.min(layout.vw, layout.x + layout.w);
            const top = Math.max(0, layout.y), bottom = Math.min(layout.vh, layout.y + layout.h);
            PATHS.forEach(([a, b, c, d, o], i) => {
                const nx = 0.5 + 0.38 * Math.sin(t * a + o) + 0.12 * Math.sin(t * b + o * 1.7);
                const ny = 0.5 + 0.36 * Math.sin(t * c + o * 0.6) + 0.12 * Math.cos(t * d + o);
                centers[i * 2] = left + (right - left) * nx;
                centers[i * 2 + 1] = top + (bottom - top) * ny;
            });
            gl.uniform2fv(uCenters, centers);
        }

        // ----- Text ripple -----------------------------------------------
        // Every letter of the sky text is moved by the same wave field the
        // shader uses, sampled at the letter's center, so the text rides the
        // same ripples as the photo.
        let letters = [];   // { el, x, y }

        function splitText() {
            document.querySelectorAll(".t").forEach(el => {
                const text = el.textContent;
                el.setAttribute("aria-label", text);
                el.textContent = "";
                for (const ch of text) {
                    const span = document.createElement("span");
                    span.className = "ch";
                    span.setAttribute("aria-hidden", "true");
                    span.textContent = ch;
                    el.appendChild(span);
                }
            });
            document.body.classList.add("rippling");
        }

        // Record each letter's resting center, and size/offset the gradient
        // so it spans the whole word.
        function measureText() {
            document.querySelectorAll(".ch").forEach(sp => { sp.style.transform = ""; });
            letters = [];
            document.querySelectorAll(".t").forEach(el => {
                const box = el.getBoundingClientRect();
                el.style.setProperty("--W", `${box.width}px`);
                el.querySelectorAll(".ch").forEach(sp => {
                    const r = sp.getBoundingClientRect();
                    sp.style.setProperty("--ox", `${r.left - box.left}px`);
                    letters.push({ el: sp, x: r.left + r.width / 2, y: r.top + r.height / 2 });
                });
            });
        }

        // CPU copy of the shader's wave math.
        let phase = 0;
        function slopeAt(x, y) {
            let gx = 0, gy = 0;
            for (let i = 0; i < 3; i++) {
                const dx = x - centers[i * 2], dy = y - centers[i * 2 + 1];
                const r = Math.hypot(dx, dy) + 0.001;
                const c = Math.min(r / CLEAR, 1);
                const env = c * c * (3 - 2 * c) * Math.exp(-r / REACH);
                const w = env * Math.cos(r * K - phase) / r;
                gx += dx * w;
                gy += dy * w;
            }
            return [gx, gy];
        }

        function moveText() {
            for (const l of letters) {
                const [gx, gy] = slopeAt(l.x, l.y);
                // The shader samples the photo at +offset, so the picture
                // appears shifted by -offset; match that.
                l.el.style.transform = `translate(${(-gx * REFRACT).toFixed(2)}px, ${(-gy * REFRACT).toFixed(2)}px)`;
            }
        }

        const OMEGA = K * RING_SPEED; // radians per second
        function frame(now) {
            const t = now / 1000;
            placeCenters(t * DRIFT);
            phase = (t * OMEGA) % (2 * Math.PI);
            gl.uniform1f(uPhase, phase);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            moveText();
            requestAnimationFrame(frame);
        }

        // Letters are re-measured via the "skyplaced" event, which fires
        // after the items are repositioned (including on resize).
        window.addEventListener("resize", resize);

        const img = new Image();
        img.onload = () => {
            let source = img;
            // Downscale if the GPU can't hold the full-size photo.
            const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
            if (img.naturalWidth > max || img.naturalHeight > max) {
                const s = max / Math.max(img.naturalWidth, img.naturalHeight);
                source = document.createElement("canvas");
                source.width = Math.floor(img.naturalWidth * s);
                source.height = Math.floor(img.naturalHeight * s);
                source.getContext("2d").drawImage(img, 0, 0, source.width, source.height);
            }
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);

            resize();
            canvas.style.display = "block";
            const bg = document.querySelector(".bg");
            if (bg) bg.style.visibility = "hidden";
            splitText();
            // Splitting into per-letter spans can nudge word widths, so lay
            // the sky out again (this also re-measures the letters).
            scatter();
            measureText();
            document.addEventListener("skyplaced", measureText);
            // Re-measure once the web font has loaded and widths settle.
            if (document.fonts) document.fonts.ready.then(measureText);
            requestAnimationFrame(frame);
        };
        img.src = BG_SRC;
    })();
})();
