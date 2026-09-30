'use client';

import { useEffect, useRef, useState } from 'react';
import { Star } from './Hero';

/**
 * A twisted four-point star in polished chrome, turning slowly. Drawn by one
 * small fragment shader (ray-marched, no library), transparent around the
 * shape so the card's gradient shows through. Without WebGL, or with reduced
 * motion, a still star stands in.
 */

const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform vec2 R;
uniform float T;
uniform float S;

mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float shape(vec3 p){
    p /= 1.45;
    p.xz *= rot(sin(T * 0.23) * 0.75 + S * 1.2);
    p.yz *= rot(0.38 + sin(T * 0.31) * 0.2);
    p.xy *= rot(T * 0.08 + 0.4);
    float r = length(p.xy);
    p.xy *= rot(0.62 * r);
    p.yz *= rot(p.x * 0.45);
    vec3 a = abs(p) / vec3(1.0, 1.0, 0.42) + 1e-5;
    const float k = 0.6;
    float f = pow(pow(a.x, k) + pow(a.y, k) + pow(a.z, k), 1.0 / k);
    return (f - 1.0) * 1.45;
}

vec3 env(vec3 r){
    // A studio of soft lights over a dark grey room: chrome is only ever
    // what it reflects, so the bands here are what make it read as metal.
    vec3 c = vec3(0.04, 0.04, 0.045);
    c += vec3(0.7, 0.7, 0.74) * exp(-pow((r.y - 0.12) * 3.5, 2.0)) * 0.8;
    c += vec3(1.0, 0.97, 1.0) * smoothstep(0.5, 0.85, r.y);
    c += vec3(0.3, 0.3, 0.33) * smoothstep(-0.25, -0.9, r.y) * 0.55;
    c += vec3(0.95, 0.95, 0.97) * smoothstep(0.06, 0.0, abs(r.x - 0.4)) * 0.6;
    c += vec3(1.0) * pow(max(dot(r, normalize(vec3(-0.6, 0.45, 0.65))), 0.0), 40.0) * 1.4;
    return c * (0.8 + 0.2 * r.x);
}

vec3 normalAt(vec3 p){
    vec2 e = vec2(0.0025, 0.0);
    return normalize(vec3(
        shape(p + e.xyy) - shape(p - e.xyy),
        shape(p + e.yxy) - shape(p - e.yxy),
        shape(p + e.yyx) - shape(p - e.yyx)));
}

void main(){
    vec2 uv = (gl_FragCoord.xy - 0.5 * R) / min(R.x, R.y);
    vec3 ro = vec3(0.0, 0.0, 4.3);
    vec3 rd = normalize(vec3(uv, -1.55));
    // Every turn in shape() is a rotation, so the star stays inside this sphere.
    float b = dot(ro, rd);
    float disc = b * b - (dot(ro, ro) - 1.5 * 1.5);
    if (disc < 0.0) { gl_FragColor = vec4(0.0); return; }
    float t = -b - sqrt(disc);
    float tEnd = -b + sqrt(disc);
    bool hit = false;
    for (int i = 0; i < 140; i++) {
        vec3 p = ro + rd * t;
        float f = shape(p);
        // shape() is not a true distance: divide by its slope for a safe step.
        vec2 e = vec2(0.003, 0.0);
        vec3 g = vec3(shape(p + e.xyy), shape(p + e.yxy), shape(p + e.yyx)) - f;
        float d = f / max(length(g) / 0.003, 1.0);
        if (d < 0.002) { hit = true; break; }
        t += max(d * 0.8, 0.0015);
        if (t > tEnd) break;
    }
    if (!hit) { gl_FragColor = vec4(0.0); return; }
    vec3 p = ro + rd * t;
    vec3 n = normalAt(p);
    vec3 col = env(reflect(rd, n));
    float fres = pow(1.0 - max(dot(-rd, n), 0.0), 3.0);
    col = col + vec3(0.6, 0.6, 0.64) * fres * 0.35;
    col = pow(col, vec3(0.92));
    gl_FragColor = vec4(col, 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'shader');
    return shader;
}

export function ChromeStar({ className = '' }: { className?: string }) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const [fallback, setFallback] = useState(false);

    useEffect(() => {
        const el = canvas.current;
        if (!el) return;
        const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const gl = el.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
        if (!gl) return setFallback(true);
        let program: WebGLProgram;
        try {
            program = gl.createProgram()!;
            gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
            gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('link');
        } catch (error) {
            console.warn('ChromeStar:', error);
            return setFallback(true);
        }
        gl.useProgram(program);
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(program, 'a');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        const uR = gl.getUniformLocation(program, 'R');
        const uT = gl.getUniformLocation(program, 'T');
        const uS = gl.getUniformLocation(program, 'S');

        const size = () => {
            // Ray marching is per pixel, so keep the pixel count modest.
            const scale = Math.min(window.devicePixelRatio || 1, 1.5);
            const w = Math.min(el.clientWidth * scale, 900);
            const h = Math.min(el.clientHeight * scale, 900);
            el.width = Math.max(1, Math.round(w));
            el.height = Math.max(1, Math.round(h));
            gl.viewport(0, 0, el.width, el.height);
        };
        size();

        let frame = 0;
        let visible = false;
        const start = performance.now();
        const draw = (now: number) => {
            const rect = el.getBoundingClientRect();
            const scroll = (rect.top + rect.height / 2) / window.innerHeight - 0.5;
            gl.uniform2f(uR, el.width, el.height);
            gl.uniform1f(uT, still ? 1.2 : (now - start) / 1000);
            gl.uniform1f(uS, still ? 0 : scroll);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            frame = visible && !still ? requestAnimationFrame(draw) : 0;
        };
        const seen = new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            if (visible && !frame) frame = requestAnimationFrame(draw);
        });
        seen.observe(el);
        const resize = new ResizeObserver(() => {
            size();
            if (!frame) frame = requestAnimationFrame(draw);
        });
        resize.observe(el);
        return () => {
            seen.disconnect();
            resize.disconnect();
            cancelAnimationFrame(frame);
        };
    }, []);

    if (fallback) {
        return (
            <div className={`flex items-center justify-center ${className}`} aria-hidden>
                <Star size={320} className="size-[70%] rotate-12 text-white/85 drop-shadow-[0_20px_60px_rgb(255_255_255/0.35)]" />
            </div>
        );
    }
    return <canvas ref={canvas} className={className} aria-hidden />;
}
