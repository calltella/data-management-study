const canvas = document.querySelector("canvas");
const context = canvas.getContext("2d");
const undo = document.querySelector("#undo");
const clear = document.querySelector("#clear");
const strokes = [];
let activePointer = null;

function draw(from, to) {
  context.beginPath();
  if (from === to) {
    context.arc(from.x, from.y, context.lineWidth / 2, 0, 2 * Math.PI);
    context.fill();
  } else {
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }
}

function redraw() {
  context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  for (const stroke of strokes) {
    draw(stroke[0], stroke[0]);
    for (let i = 1; i < stroke.length; i++) draw(stroke[i - 1], stroke[i]);
  }
  undo.disabled = clear.disabled = strokes.length === 0 || activePointer !== null;
}

function resize() {
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * scale);
  canvas.height = Math.round(canvas.clientHeight * scale);
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.strokeStyle = context.fillStyle = "#223732";
  context.lineWidth = 2.5;
  context.lineCap = "round";
  redraw();
}

function position(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function extendStroke(event) {
  if (activePointer !== event.pointerId) return;
  const stroke = strokes.at(-1);
  const point = position(event);
  draw(stroke.at(-1), point);
  stroke.push(point);
}

canvas.onpointerdown = (event) => {
  if (event.button !== 0 || activePointer !== null) return;
  activePointer = event.pointerId;
  canvas.setPointerCapture(activePointer);
  const point = position(event);
  strokes.push([point]);
  undo.disabled = clear.disabled = true;
  draw(point, point);
};
canvas.onpointermove = extendStroke;
canvas.onpointerup = extendStroke;
canvas.onlostpointercapture = (event) => {
  if (activePointer !== event.pointerId) return;
  activePointer = null;
  undo.disabled = clear.disabled = false;
};

undo.onclick = () => {
  strokes.pop();
  redraw();
};
clear.onclick = () => {
  strokes.length = 0;
  redraw();
};

resize();
new ResizeObserver(resize).observe(canvas);
window.addEventListener("resize", resize);
