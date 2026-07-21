<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps({
  active: Boolean,
  busy: Boolean,
  error: Boolean,
});

const emit = defineEmits(["activate"]);
const canvas = ref(null);

const colorFields = [
  { color: "34, 197, 94", phase: 0.2, speed: 0.83 },
  { color: "56, 189, 248", phase: 2.1, speed: 0.71 },
  { color: "236, 72, 153", phase: 4.15, speed: 0.61 },
  { color: "251, 191, 36", phase: 5.35, speed: 0.93 },
];

let animationFrame = 0;
let lastPaintAt = 0;
let reducedMotion = false;
let motionQuery = null;
let resizeObserver = null;

function paintOrb(now = performance.now()) {
  const element = canvas.value;
  if (!element) return;
  const bounds = element.getBoundingClientRect();
  const size = Math.max(1, Math.round(bounds.width));
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const renderSize = Math.max(1, Math.round(size * pixelRatio));
  if (element.width !== renderSize || element.height !== renderSize) {
    element.width = renderSize;
    element.height = renderSize;
  }

  const context = element.getContext("2d");
  if (!context) return;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, size, size);

  const center = size / 2;
  const radius = center - 0.8;
  const speed = reducedMotion ? 0 : props.busy ? 1.9 : 1.15;
  const time = reducedMotion ? 0.85 : (now / 1000) * speed;
  const amplitude = size * (props.busy ? 0.21 : 0.19);

  context.save();
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.clip();

  const base = context.createRadialGradient(center * 0.72, center * 0.62, size * 0.04, center, center, size * 0.62);
  base.addColorStop(0, "#163144");
  base.addColorStop(0.48, "#0c1727");
  base.addColorStop(1, "#050810");
  context.fillStyle = base;
  context.fillRect(0, 0, size, size);

  context.globalCompositeOperation = "screen";
  colorFields.forEach((field, index) => {
    const x = center + Math.sin(time * field.speed + field.phase) * amplitude;
    const y = center + Math.cos(time * (field.speed + 0.16) + field.phase * 0.74) * amplitude;
    const fieldRadius = size * (0.4 + Math.sin(time * 0.37 + index) * 0.035);
    const glow = context.createRadialGradient(x, y, 0, x, y, fieldRadius);
    glow.addColorStop(0, `rgba(${field.color}, ${props.busy ? 0.98 : 0.9})`);
    glow.addColorStop(0.36, `rgba(${field.color}, 0.58)`);
    glow.addColorStop(1, `rgba(${field.color}, 0)`);
    context.fillStyle = glow;
    context.fillRect(0, 0, size, size);
  });

  context.globalCompositeOperation = "source-over";
  const highlight = context.createRadialGradient(size * 0.32, size * 0.25, 0, size * 0.32, size * 0.25, size * 0.34);
  highlight.addColorStop(0, "rgba(255, 255, 255, 0.45)");
  highlight.addColorStop(0.3, "rgba(255, 255, 255, 0.1)");
  highlight.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = highlight;
  context.fillRect(0, 0, size, size);

  const vignette = context.createRadialGradient(center, center, size * 0.22, center, center, size * 0.58);
  vignette.addColorStop(0, "rgba(2, 6, 16, 0)");
  vignette.addColorStop(0.7, "rgba(2, 6, 16, 0.08)");
  vignette.addColorStop(1, "rgba(2, 6, 16, 0.52)");
  context.fillStyle = vignette;
  context.fillRect(0, 0, size, size);
  context.restore();

  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.strokeStyle = props.error ? "rgba(251, 113, 133, 0.9)" : "rgba(255, 255, 255, 0.46)";
  context.lineWidth = 1;
  context.stroke();
}

function animate(now) {
  if (document.hidden || reducedMotion || !canvas.value) {
    animationFrame = 0;
    return;
  }
  const frameInterval = props.busy ? 1000 / 60 : 1000 / 30;
  if (now - lastPaintAt >= frameInterval) {
    paintOrb(now);
    lastPaintAt = now;
  }
  animationFrame = requestAnimationFrame(animate);
}

function startAnimation() {
  if (animationFrame || reducedMotion || document.hidden) return;
  animationFrame = requestAnimationFrame(animate);
}

function stopAnimation() {
  if (!animationFrame) return;
  cancelAnimationFrame(animationFrame);
  animationFrame = 0;
}

function handleVisibilityChange() {
  if (document.hidden) stopAnimation();
  else {
    paintOrb();
    startAnimation();
  }
}

function handleMotionChange(event) {
  reducedMotion = event.matches;
  if (reducedMotion) {
    stopAnimation();
    paintOrb();
  } else startAnimation();
}

watch(() => [props.active, props.busy, props.error], () => {
  paintOrb();
  startAnimation();
});

onMounted(() => {
  motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  reducedMotion = motionQuery.matches;
  if (motionQuery.addEventListener) motionQuery.addEventListener("change", handleMotionChange);
  else motionQuery.addListener?.(handleMotionChange);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  if (window.ResizeObserver && canvas.value) {
    resizeObserver = new ResizeObserver(() => paintOrb());
    resizeObserver.observe(canvas.value);
  }
  paintOrb();
  startAnimation();
});

onBeforeUnmount(() => {
  stopAnimation();
  resizeObserver?.disconnect();
  if (motionQuery?.removeEventListener) motionQuery.removeEventListener("change", handleMotionChange);
  else motionQuery?.removeListener?.(handleMotionChange);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
});
</script>

<template>
  <el-tooltip content="SmartQ 小助手" placement="left" :show-after="300">
    <button
      type="button"
      class="assistant-trigger"
      :class="{ 'is-active': active, 'is-busy': busy, 'has-error': error }"
      aria-label="打开 SmartQ 小助手"
      aria-haspopup="dialog"
      :aria-expanded="active"
      @click="emit('activate')"
    >
      <span class="assistant-trigger__orb" aria-hidden="true">
        <canvas ref="canvas" width="48" height="48" />
      </span>
    </button>
  </el-tooltip>
</template>

<style scoped>
.assistant-trigger {
  position: fixed;
  right: max(20px, calc(env(safe-area-inset-right) + 12px));
  bottom: max(20px, calc(env(safe-area-inset-bottom) + 12px));
  z-index: 60;
  display: grid;
  width: 56px;
  height: 56px;
  padding: 5px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  isolation: isolate;
  place-items: center;
  transition: transform 180ms ease, filter 180ms ease;
  filter: drop-shadow(0 8px 16px rgba(15, 23, 42, 0.25));
  -webkit-tap-highlight-color: transparent;
}

.assistant-trigger::before {
  position: absolute;
  z-index: 0;
  inset: 4px;
  border-radius: inherit;
  background: conic-gradient(from 0deg, rgba(34, 197, 94, 0.72), rgba(56, 189, 248, 0.7), rgba(236, 72, 153, 0.66), rgba(251, 191, 36, 0.68), rgba(34, 197, 94, 0.72));
  content: "";
  opacity: 0.42;
  filter: blur(7px);
  animation: assistant-orbit 10s linear infinite;
}

.assistant-trigger:hover,
.assistant-trigger:focus-visible {
  transform: translateY(-2px) scale(1.04);
  filter: drop-shadow(0 10px 20px rgba(15, 23, 42, 0.32));
}

.assistant-trigger:focus-visible {
  outline: 3px solid var(--el-color-primary-light-5);
  outline-offset: 2px;
}

.assistant-trigger__orb {
  position: relative;
  z-index: 1;
  display: block;
  width: 46px;
  height: 46px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 50%;
  background: #07101c;
  box-shadow: inset 0 0 10px rgba(255, 255, 255, 0.08), 0 0 0 1px rgba(15, 23, 42, 0.12);
}

.assistant-trigger__orb::after {
  position: absolute;
  inset: 2px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: inherit;
  content: "";
  pointer-events: none;
}

.assistant-trigger canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.assistant-trigger.is-active::before {
  opacity: 0.58;
}

.assistant-trigger.is-busy::before {
  opacity: 0.82;
  animation-duration: 1.6s;
}

.assistant-trigger.is-busy .assistant-trigger__orb {
  animation: assistant-breathe 1.5s ease-in-out infinite;
}

.assistant-trigger.has-error::before {
  background: conic-gradient(from 0deg, rgba(251, 113, 133, 0.88), rgba(236, 72, 153, 0.7), rgba(251, 113, 133, 0.88));
  opacity: 0.72;
}

@keyframes assistant-orbit {
  to { transform: rotate(1turn); }
}

@keyframes assistant-breathe {
  50% { transform: scale(0.92); }
}

@media (max-width: 640px) {
  .assistant-trigger {
    right: max(14px, calc(env(safe-area-inset-right) + 8px));
    bottom: max(14px, calc(env(safe-area-inset-bottom) + 8px));
    width: 52px;
    height: 52px;
    padding: 5px;
  }

  .assistant-trigger__orb {
    width: 42px;
    height: 42px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .assistant-trigger,
  .assistant-trigger::before,
  .assistant-trigger__orb {
    animation: none !important;
    transition: none;
  }

  .assistant-trigger:hover,
  .assistant-trigger:focus-visible {
    transform: none;
  }
}
</style>
