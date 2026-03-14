const {JSDOM} = require("jsdom");
const fs = require("fs");
const js = fs.readFileSync("dist/assets/index-CA2DGqCD.js", "utf8");
const css = fs.readFileSync("dist/assets/index-DPP14Rcj.css", "utf8");

const dom = new JSDOM(`<!doctype html><html><head><style>${css}</style></head><body><div id="root"></div></body></html>`, {
  url: "http://localhost:8082",
  runScripts: "dangerously",
  resources: "usable",
  pretendToBeVisual: true,
});

const w = dom.window;
w.matchMedia = () => ({matches:false,addListener:()=>{},removeListener:()=>{},addEventListener:()=>{},removeEventListener:()=>{},dispatchEvent:()=>{}});
w.localStorage = {_d:{}, getItem(k){return this._d[k]||null}, setItem(k,v){this._d[k]=String(v)}, removeItem(k){delete this._d[k]}, clear(){this._d={}}};
w.IntersectionObserver = class{observe(){}unobserve(){}disconnect(){}};
w.ResizeObserver = class{observe(){}unobserve(){}disconnect(){}};
w.requestAnimationFrame = (cb) => setTimeout(cb, 0);
w.cancelAnimationFrame = clearTimeout;
w.fetch = () => Promise.resolve({ok:true,json:()=>Promise.resolve({status:"ok",vllm:true})});
w.SpeechRecognition = undefined;
w.webkitSpeechRecognition = undefined;

w.addEventListener("error", (e) => {
  console.log("WINDOW ERROR:", e.message);
  if (e.error) console.log("STACK:", e.error.stack?.split("\n").slice(0,5).join("\n"));
});

try {
  const script = w.document.createElement("script");
  script.textContent = js;
  w.document.body.appendChild(script);
} catch(e) {
  console.log("EXECUTION ERROR:", e.message);
  console.log("STACK:", e.stack?.split("\n").slice(0,5).join("\n"));
}

setTimeout(() => {
  const root = w.document.getElementById("root");
  console.log("ROOT children:", root?.children.length);
  console.log("ROOT html:", (root?.innerHTML || "").slice(0, 500));
  if (!root?.children.length) console.log("EMPTY - React did not mount!");
  dom.window.close();
  process.exit(0);
}, 3000);
