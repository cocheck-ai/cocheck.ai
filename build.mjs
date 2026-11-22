// Zero-dependency static site builder. Reads essays-src/*.md, writes docs/.  Usage: node build.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const SRC = join(root, "essays-src");
const OUT = join(root, "docs");
const REPO = "https://github.com/cocheck-ai/cocheck";
const RELEASES = `${REPO}/releases`;
const SITE = "https://cocheck.ai/";
const RAW = "https://raw.githubusercontent.com/cocheck-ai/cocheck/main";
const INSTALL_DOC = `${REPO}/blob/main/docs/install.md`;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------- Markdown subset ----------
function safeUrl(u) {
  const t = u.trim();
  return /^(https?:\/\/|mailto:|\/|#|[\w.-]+(\/|\.html|$))/i.test(t) && !/^\s*(javascript|data|vbscript):/i.test(t) ? t : "#";
}
// Footnotes: `[^label]` references, `[^label]: text` definitions (indented continuation lines, blank-separated
// paragraphs allowed). Numbered in order of first reference. FN is the per-essay state while it is converted.
let FN = null;
function footnoteRef(label) {
  if (!FN) throw new Error(`footnote reference [^${label}] outside an essay`);
  if (!FN.defs.has(label)) throw new Error(`${FN.file}: footnote [^${label}] is referenced but never defined`);
  let n = FN.order.indexOf(label) + 1;
  if (!n) { FN.order.push(label); n = FN.order.length; }
  const k = (FN.refs.get(label) || 0) + 1;
  FN.refs.set(label, k);
  const id = k === 1 ? `fnref-${n}` : `fnref-${n}-${k}`;
  return `<sup class="fn-ref"><a href="#fn-${n}" id="${id}" role="doc-noteref" aria-label="Footnote ${n}">${n}</a></sup>`;
}
function extractFootnotes(src, file) {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const defs = new Map(), body = [];
  const defRe = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]?(.*)$/, indented = /^( {4}|\t)/;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^```/.test(l)) inFence = !inFence;
    const m = !inFence && l.match(defRe);
    if (!m) { body.push(l); continue; }
    if (defs.has(m[1])) throw new Error(`${file}: footnote [^${m[1]}] is defined twice`);
    const buf = [m[2].trim()];
    let lazy = buf[0] !== "";
    while (i + 1 < lines.length) {
      const nx = lines[i + 1];
      if (indented.test(nx)) { buf.push(nx.replace(indented, "")); lazy = true; i++; continue; }
      if (nx.trim() === "") {
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === "") j++;
        if (j < lines.length && indented.test(lines[j])) { for (; i + 1 < j; i++) buf.push(""); continue; }
        break;
      }
      if (lazy && !defRe.test(nx) && !/^(```|#{1,6}\s|>|\s*[-*+]\s|\s*\d+[.)]\s)/.test(nx)) { buf.push(nx); i++; continue; }
      break;
    }
    defs.set(m[1], buf.join("\n"));
  }
  return { body: body.join("\n"), defs };
}
function renderFootnotes() {
  const items = [];
  for (let n = 1; n <= FN.order.length; n++) {        // rendering a definition may append newly referenced labels
    const label = FN.order[n - 1];
    let html = markdown(FN.defs.get(label));
    const refs = FN.refs.get(label);
    const back = Array.from({ length: refs }, (_, j) => `<a href="#${j ? `fnref-${n}-${j + 1}` : `fnref-${n}`}" class="fn-back" role="doc-backlink" aria-label="Back to reference ${n}${refs > 1 ? `-${j + 1}` : ""}">&#8617;&#xFE0E;${refs > 1 ? `<sup>${j + 1}</sup>` : ""}</a>`).join(" ");
    html = /<\/p>$/.test(html) ? html.replace(/<\/p>$/, ` ${back}</p>`) : `${html}\n<p>${back}</p>`;
    items.push(`<li id="fn-${n}">${html}</li>`);
  }
  const unused = [...FN.defs.keys()].filter((l) => !FN.order.includes(l));
  if (unused.length) throw new Error(`${FN.file}: footnote(s) defined but never referenced: ${unused.map((l) => `[^${l}]`).join(", ")}`);
  return items.length ? `\n<section class="footnotes" role="doc-endnotes" aria-label="Footnotes"><ol>\n${items.join("\n")}\n</ol></section>` : "";
}
function essayHtml(body, file) {
  const { body: text, defs } = extractFootnotes(body, file);
  FN = { file, defs, order: [], refs: new Map() };
  try { return markdown(text) + renderFootnotes(); } finally { FN = null; }
}
function inline(text) {
  const codes = [], notes = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => { codes.push(`<code>${esc(c)}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/\[\^([^\]\s]+)\]/g, (_, label) => { notes.push(footnoteRef(label)); return `\u0001${notes.length - 1}\u0001`; });
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${esc(safeUrl(u.replace(/&amp;/g, "&")))}">${t}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>");
  return s.replace(/\u0001(\d+)\u0001/g, (_, i) => notes[+i]).replace(/\u0000(\d+)\u0000/g, (_, i) => codes[+i]);
}
function markdown(src) {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  const blank = (l) => l.trim() === "";
  while (i < lines.length) {
    const l = lines[i];
    if (blank(l)) { i++; continue; }
    const fence = l.match(/^```/);
    if (fence) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    const h = l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) { const n = Math.min(h[1].length + 1, 6); out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }
    if (/^>/.test(l)) {
      const buf = [];
      while (i < lines.length && /^>/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${markdown(buf.join("\n"))}</blockquote>`);
      continue;
    }
    const ul = /^\s*[-*+]\s+/, ol = /^\s*\d+[.)]\s+/;
    if (ul.test(l) || ol.test(l)) {
      const re = ul.test(l) ? ul : ol, tag = re === ul ? "ul" : "ol", items = [];
      while (i < lines.length && re.test(lines[i])) {
        let t = lines[i++].replace(re, "");
        while (i < lines.length && !blank(lines[i]) && !ul.test(lines[i]) && !ol.test(lines[i]) && /^\s+/.test(lines[i])) t += " " + lines[i++].trim();
        items.push(`<li>${inline(t)}</li>`);
      }
      out.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }
    const buf = [];
    while (i < lines.length && !blank(lines[i]) && !/^(```|#{1,6}\s|>|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[i])) buf.push(lines[i++].trim());
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}
function frontMatter(raw, file) {
  const m = raw.replace(/\r\n?/g, "\n").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing front matter`);
  const meta = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  if (!meta.title || !/^\d{4}-\d{2}-\d{2}$/.test(meta.date ?? "")) throw new Error(`${file}: front matter needs title and date (YYYY-MM-DD)`);
  return { meta, body: m[2] };
}
const prettyDate = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });


// ---------- Template ----------
import { copyFileSync } from "node:fs";

const CSS = `
:root{
  color-scheme:light dark;
  --font:-apple-system,BlinkMacSystemFont,"Segoe UI Variable","Segoe UI",system-ui,sans-serif;
  --serif:ui-serif,"New York",Charter,"Iowan Old Style",Georgia,serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  /* four sizes: small 14, body 16, heading 20, display 48 */
  --fs-sm:14px; --fs-md:16px; --fs-lg:20px; --fs-xl:48px;
  --s1:8px; --s2:16px; --s3:24px; --s4:32px; --s5:48px; --s6:64px; --s7:96px;
  --r-sm:4px; --r:8px; --r-lg:12px;
  --canvas:#f4f5f7; --surface:#fff; --well:#e6e8ec;
  --ink:#16181d; --ink-2:#5b616c; --ink-3:#6b717b; --hairline:rgba(22,24,29,.1); --shade:#10121a;
  --before:#2f6bd8; --after:#cc2f76; --pass:#1e7b45; --navy:#1c2740;
  --sel-a:12%;
}
@media (prefers-color-scheme:dark){:root{
  --canvas:#1c1d20; --surface:#26272b; --well:#2e3034;
  --ink:#ecedef; --ink-2:#a2a7b0; --ink-3:#8e939c; --hairline:rgba(255,255,255,.08); --shade:#000;
  --before:#5b93f5; --after:#f2639f; --pass:#3fb56e; --sel-a:20%;
}}
:root{
  --before-tint:color-mix(in srgb,var(--before) 10%,var(--surface));
  --before-wash:color-mix(in srgb,var(--before) 30%,var(--surface));
  --after-tint:color-mix(in srgb,var(--after) 8%,var(--surface));
  --after-wash:color-mix(in srgb,var(--after) 30%,var(--surface));
  --shadow-1:0 1px 2px color-mix(in srgb,var(--shade) 7%,transparent);
  --shadow-pop:0 16px 32px -16px color-mix(in srgb,var(--shade) 28%,transparent),0 0 0 1px var(--hairline);
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;font:var(--fs-md)/1.6 var(--font);color:var(--ink);background:var(--canvas)}
::selection{background:color-mix(in srgb,var(--before) var(--sel-a),transparent)}
a{color:var(--before);text-underline-offset:3px}
:focus-visible{outline:2px solid var(--before);outline-offset:2px;border-radius:var(--r-sm)}
img{max-width:100%}
/* one container: header, main, sidebar and footer share its edges */
.wrap{max-width:1160px;margin:0 auto;padding:0 var(--s4)}
.bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:0 var(--s3);padding:var(--s1) var(--s2);background:var(--navy);color:#dfe8f3;font-size:var(--fs-sm);line-height:24px}
.bar a{color:#fff;font-weight:500;text-underline-offset:3px}
header.site{display:flex;align-items:center;justify-content:space-between;gap:var(--s2);height:80px}
.brand{display:inline-flex;align-items:center;gap:var(--s1);text-decoration:none}
.brand .wm{height:32px;width:auto;display:block;margin-left:-4px}
nav{display:flex;gap:var(--s3)}
nav a[aria-current]{color:var(--ink);font-weight:600}
nav{font-size:var(--fs-sm)}
nav a{color:var(--ink-2);text-decoration:none}nav a:hover{color:var(--ink);text-decoration:underline}
/* grid: main | sidebar */
.shell{display:grid;grid-template-columns:minmax(0,1fr) 312px;padding-top:var(--s4);min-height:calc(100vh - 240px)}
.shell.solo{grid-template-columns:minmax(0,1fr)}
.main{min-width:0;padding-right:var(--s4)}
.solo .main{padding-right:0}
/* type */
h1,h2{font-family:var(--serif);font-weight:600;letter-spacing:-.015em;color:var(--ink);margin:0}
h1{font-size:var(--fs-xl);line-height:1.08;letter-spacing:-.025em;text-wrap:balance;max-width:16em}
h2{font-size:var(--fs-lg);line-height:1.3}
h3,h4,h5,h6{font-size:var(--fs-md);line-height:1.4;font-weight:600;margin:var(--s3) 0 var(--s1)}
p,ul,ol,blockquote,pre{margin:0 0 var(--s2)}
ul,ol{padding-left:var(--s3)}
.quiet,.meta{color:var(--ink-2);font-size:var(--fs-sm);line-height:1.5}
blockquote{padding:0 0 0 var(--s2);border-left:3px solid var(--before-wash);color:var(--ink-2)}
blockquote>:last-child{margin-bottom:0}
code{font:var(--fs-sm)/1.5 var(--mono);background:var(--well);padding:1px 6px;border-radius:var(--r-sm)}
pre{background:var(--surface);border:1px solid var(--hairline);border-radius:var(--r);box-shadow:var(--shadow-1);padding:var(--s2);overflow-x:auto}
pre code{background:none;padding:0}
.lede{font-size:var(--fs-lg);line-height:1.5;color:var(--ink-2);margin:var(--s2) 0 var(--s4);max-width:34em}
/* sections: one gap, no dividers */
.hero{padding-bottom:var(--s6)}
.band{padding-bottom:var(--s6)}
.band h2{margin-bottom:var(--s3)}
.hero>*:last-child,.band>*:last-child{margin-bottom:0}
/* install */
.install{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s2);margin:0 0 var(--s4)}
.cmd{position:relative;background:var(--surface);border:1px solid var(--hairline);border-radius:var(--r);box-shadow:var(--shadow-1);padding:var(--s2);min-width:0}
.cmd .quiet{display:block;margin-bottom:var(--s1)}
.cmd code{display:block;background:none;padding:0;white-space:pre;overflow-x:auto;padding-right:72px}
.install-notes{color:var(--ink-2);font-size:var(--fs-sm);line-height:1.6;max-width:44em;margin:0 0 var(--s4)}
.install-notes p{margin:0 0 var(--s1)}
.install-notes p:last-child{margin:0}
.copy{position:absolute;right:var(--s1);top:var(--s1);font:500 var(--fs-sm)/1 var(--font);color:var(--ink);background:var(--canvas);border:1px solid var(--hairline);border-radius:var(--r-sm);padding:8px 12px;cursor:pointer}
.copy:hover{background:var(--well)}
.copy.done{color:var(--pass)}
/* illustration: the review page's change card */
.demo{margin:0;background:var(--surface);border-radius:var(--r-lg);box-shadow:var(--shadow-pop);overflow:hidden;font-size:var(--fs-sm);line-height:1.5}
.demo .top{display:flex;align-items:center;gap:var(--s2);padding:var(--s2);border-bottom:1px solid var(--hairline);background:var(--canvas)}
.demo .top .quiet{margin-left:auto;white-space:nowrap}
.action{display:flex;align-items:center;gap:var(--s2);padding:var(--s2);border-bottom:1px solid var(--hairline)}
.chip{flex:none;width:24px;height:24px;border-radius:50%;background:var(--after);color:#16181d;font-size:var(--fs-sm);font-weight:600;line-height:24px;text-align:center}
.action .what b{font-weight:600}
.action .what span{display:block;color:var(--ink-2)}
.panes{display:grid;grid-template-columns:1fr 1fr}
.pane{padding:var(--s2) var(--s3);min-width:0}
.pane+.pane{border-left:1px solid var(--hairline)}
.pane h4{margin:0 0 var(--s1);font-size:var(--fs-sm);display:flex;align-items:center;gap:var(--s1)}
.pane h4 i{width:8px;height:8px;border-radius:50%;display:inline-block}
.pane.b{background:var(--before-tint)}.pane.b h4{color:var(--before)}.pane.b h4 i{background:var(--before)}
.pane.a{background:var(--after-tint)}.pane.a h4{color:var(--after)}.pane.a h4 i{background:var(--after)}
.pane p{font-family:var(--serif);font-size:var(--fs-md);line-height:1.6;margin:0 0 var(--s1)}
.pane p:last-child{margin:0}
.pane .chg{border-radius:var(--r-sm);padding:1px 4px;box-shadow:0 0 0 1.5px currentColor inset}
.pane.b .chg{color:var(--before);background:var(--before-wash)}
.pane.a .chg{color:var(--after);background:var(--after-wash)}
.pane .chg span{color:var(--ink)}
.demo .foot{padding:var(--s1) var(--s2);border-top:1px solid var(--hairline);color:var(--ink-2);display:flex;justify-content:space-between;gap:var(--s2);flex-wrap:wrap}
.cap{margin:var(--s1) 0 0;text-align:center;font-size:var(--fs-sm);color:var(--ink-3)}
/* how it works */
.steps{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s4);counter-reset:s}
.steps li{position:relative;padding-top:var(--s3);border-top:2px solid var(--hairline);counter-increment:s}
.steps li::before{content:counter(s);position:absolute;top:-13px;left:0;width:24px;height:24px;border-radius:50%;background:var(--navy);color:#fff;font-size:var(--fs-sm);font-weight:600;line-height:24px;text-align:center}
.steps li:first-child{border-top-color:var(--before)}
.steps li:last-child{border-top-color:var(--after)}
.steps b{display:block;margin-bottom:var(--s1)}
.steps p{margin:0;color:var(--ink-2);font-size:var(--fs-sm);line-height:1.6}
/* sidebar: page background, one rule, top-aligned with the headline */
.side{border-left:1px solid var(--hairline);padding-left:var(--s4)}
.side-in{position:sticky;top:var(--s3);max-height:calc(100vh - 48px);overflow-y:auto;margin:0 0 0 calc(-1 * var(--s1));padding:0 0 0 var(--s1)}
.side h2{margin:2px 0 var(--s2);padding-left:var(--s1)}
.side-list{list-style:none;margin:0;padding:0}
.side-list li{position:relative;border-radius:var(--r)}
.side-list li a{display:block;padding:var(--s1);text-decoration:none;color:inherit;border-radius:var(--r)}
.side-list li:hover{background:var(--well)}
.side-list .t{display:block;font-family:var(--serif);font-size:var(--fs-md);font-weight:600;line-height:1.35;color:var(--ink)}
.side-list .quiet{display:block;margin-top:4px}
.side-list li.current .t{color:var(--after)}
.side-list li.current::before{content:"";position:absolute;left:-41px;top:var(--s1);bottom:var(--s1);width:2px;background:var(--after)}
/* essays */
.list{list-style:none;padding:0;margin:var(--s3) 0 0;border-top:1px solid var(--hairline)}
.list li{border-bottom:1px solid var(--hairline);padding:var(--s2) 0}
.list a{font-family:var(--serif);font-size:var(--fs-lg);font-weight:600;line-height:1.3;color:var(--ink);text-decoration:none}
.list a:hover{color:var(--before);text-decoration:underline}
.list .quiet{display:block;margin-top:4px}
article{max-width:40rem;padding-bottom:var(--s6)}
article h1{font-size:var(--fs-xl);margin-bottom:var(--s1)}
article .meta{margin-bottom:var(--s4)}
article p,article li{font-family:var(--serif);font-size:var(--fs-lg);line-height:1.7}
article p.meta{font-family:var(--font);font-size:var(--fs-sm)}
.fn-ref{font-family:var(--font);font-size:.6em;line-height:0;vertical-align:super;margin-left:1px}
.fn-ref a{text-decoration:none;padding:0 2px;border-radius:var(--r-sm)}
.fn-ref a:hover{text-decoration:underline}
:target{scroll-margin-top:var(--s4)}
.fn-ref a:target,.footnotes li:target{background:var(--before-tint)}
.footnotes{margin-top:var(--s5);padding-top:var(--s3);border-top:1px solid var(--hairline);color:var(--ink-2)}
.footnotes ol{margin:0;padding-left:var(--s3)}
.footnotes li{font-family:var(--serif);font-size:var(--fs-md);line-height:1.6;margin:0 0 var(--s1);border-radius:var(--r-sm)}
article .footnotes li p,article .footnotes li{font-size:var(--fs-md);line-height:1.6}
.footnotes li p{margin:0 0 var(--s1)}
.footnotes li p:last-child{margin-bottom:0}
.footnotes li::marker{font-family:var(--font);font-size:var(--fs-sm);color:var(--ink-3)}
.fn-back{text-decoration:none;font-family:var(--font)}
footer{border-top:1px solid var(--hairline);color:var(--ink-2);font-size:var(--fs-sm)}
footer .wrap{display:flex;justify-content:space-between;gap:var(--s2);flex-wrap:wrap;align-items:center;height:80px}
@media (max-width:900px){
  .shell{grid-template-columns:minmax(0,1fr);min-height:0}
  .main{padding-right:0}
  .side{border-left:0;border-top:1px solid var(--hairline);padding:var(--s4) 0 var(--s6)}
  .side-in{position:static;max-height:none}
  .side-list li.current::before{left:-24px}
  .steps{grid-template-columns:minmax(0,1fr);gap:var(--s5)}
  h1{font-size:40px}
}
@media (max-width:640px){
  .wrap{padding:0 var(--s2)}
  .install{grid-template-columns:minmax(0,1fr)}
  .panes{grid-template-columns:1fr}.pane+.pane{border-left:0;border-top:1px solid var(--hairline)}
  .demo .top .quiet{display:none}
  .brand .wm{height:28px}
  article h1{font-size:36px}
}
`;

const BANNER_JS = `(function(){var a=document.getElementById("rel");if(a&&window.fetch){var c=window.AbortController?new AbortController():null,t=setTimeout(function(){if(c)c.abort()},3000);fetch("https://registry.npmjs.org/cocheck/latest",{signal:c?c.signal:undefined}).then(function(r){return r.ok?r.json():null}).then(function(j){clearTimeout(t);if(j&&typeof j.version==="string"&&/^[0-9A-Za-z.+-]{1,40}$/.test(j.version))a.textContent="CoCheck "+j.version+" is out"}).catch(function(){})}
document.querySelectorAll("[data-copy]").forEach(function(box){var code=box.querySelector("code"),b=document.createElement("button");b.type="button";b.className="copy";b.textContent="Copy";b.setAttribute("aria-label","Copy command");b.onclick=function(){var txt=code.textContent,ok=function(){b.textContent="Copied";b.classList.add("done");setTimeout(function(){b.textContent="Copy";b.classList.remove("done")},1600)};if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(txt).then(ok,function(){})}else{var r=document.createRange();r.selectNodeContents(code);var s=getSelection();s.removeAllRanges();s.addRange(r);try{document.execCommand("copy");ok()}catch(e){}}};box.appendChild(b)})})();`;

let ESSAYS = [];
function page({ title, desc, body, base, current, side = true, nav = "", path = null, type = "website" }) {
  const p = base;
  const url = path === null ? null : SITE + path;
  const social = [
    `<meta property="og:site_name" content="CoCheck">`,
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    url ? `<meta property="og:url" content="${esc(url)}">` : "",
    `<meta property="og:image" content="${SITE}assets/icon-180.png">`,
    `<meta property="og:image:width" content="180">`,
    `<meta property="og:image:height" content="180">`,
    `<meta property="og:image:alt" content="CoCheck icon">`,
    `<meta name="twitter:card" content="summary">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    `<meta name="twitter:image" content="${SITE}assets/icon-180.png">`,
    url ? `<link rel="canonical" href="${esc(url)}">` : "",
  ].filter(Boolean).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="color-scheme" content="light dark">
${social}
<link rel="icon" type="image/svg+xml" href="${p}assets/icon.svg">
<link rel="icon" type="image/png" sizes="180x180" href="${p}assets/icon-180.png">
<link rel="apple-touch-icon" href="${p}assets/icon-180.png">
<style>${CSS}</style>
</head>
<body>
<div class="bar" id="banner"><a id="rel" href="${RELEASES}">CoCheck on GitHub</a></div>
<div class="wrap"><header class="site"><a class="brand" href="${p}index.html" aria-label="CoCheck home"><picture><source srcset="${p}assets/wordmark-dark.png" media="(prefers-color-scheme: dark)"><img class="wm" src="${p}assets/wordmark-light.png" width="112" height="30" alt="CoCheck"></picture></a><nav><a href="${p}index.html"${nav === "home" ? ' aria-current="page"' : ""}>Home</a><a href="${p}essays/index.html"${nav === "essays" ? ' aria-current="page"' : nav === "essay" ? ' aria-current="true"' : ""}>Essays</a><a href="${REPO}">GitHub</a></nav></header>
<div class="shell${side ? "" : " solo"}"><main class="main">${body}</main>${side ? sidebar(p, current) : ""}</div></div>
<footer><div class="wrap"><span>CoCheck is a preview release.</span><span><a href="${REPO}#readme">README on GitHub</a></span></div></footer>
<script>${BANNER_JS}</script>
</body>
</html>
`;
}

const essayItems = (list) => list.map((e) => `<li><a href="${e.href}">${esc(e.label ?? e.title)}</a><span class="quiet">${esc(prettyDate(e.date))}${e.summary ? " &middot; " + esc(e.summary) : ""}</span></li>`).join("\n");

const homeBody = () => `<section class="hero">
<h1>Keeping You in the Driver's Seat</h1>
<p class="lede">CoCheck shows what AI agents changed in your files, step by step.</p>
<div class="install">
<div class="cmd" data-copy><span class="quiet">On a Mac</span><code>brew install cocheck-ai/tap/cocheck
cocheck install --home ~/CoCheckData</code></div>
<div class="cmd" data-copy><span class="quiet">On a Mac or Windows</span><code>npm install -g cocheck
cocheck install --home ~/CoCheckData</code></div>
</div>
<div class="install-notes">
<p><code>--home</code> must be an absolute path. On Windows, cmd and Windows PowerShell pass <code>~</code> through unexpanded, so use <code>cocheck install --home "$env:USERPROFILE\\CoCheckData" --for claude</code> in PowerShell.</p>
<p>Run <code>cocheck install</code> from the folder you want CoCheck to watch, or pass <code>--folder &lt;dir&gt;</code>. Then restart your agent, start a session, say "start tracking", do some work, and say "show me the review".</p>
<p><a href="${INSTALL_DOC}">Full install guide</a> &middot; <a href="${REPO}#readme">README on GitHub</a></p>
</div>
<figure class="demo" aria-label="Illustration of a CoCheck change card: a sentence before and after an agent edit, labelled with the agent action that made it">
<div class="top"><b>contract-notes.md</b><span class="quiet">Review &middot; change 3 of 7</span></div>
<div class="action"><span class="chip" aria-hidden="true">A</span><div class="what"><b>Agent action 5: edit file</b><span>Changed contract-notes.md</span></div></div>
<div class="panes">
<div class="pane b"><h4><i></i>Before</h4><p>Payment is due within <span class="chg"><span>30 days</span></span>.</p><p>Late fees start after the grace period.</p></div>
<div class="pane a"><h4><i></i>After</h4><p>Payment is due within <span class="chg"><span>45 days</span></span>.</p><p>Late fees start after the grace period.</p></div>
</div>
<div class="foot"><span>Credited to the agent action above</span><span>1 line changed</span></div>
</figure>
<p class="cap">Illustration</p>
</section>
<section class="band"><h2>How it works</h2>
<ol class="steps">
<li><b>The agent works</b><p>Your AI agent edits your files as usual. Nothing about your workflow changes.</p></li>
<li><b>CoCheck records each change</b><p>Every change is saved with the agent action that made it, one step at a time.</p></li>
<li><b>You review before and after</b><p>Open the review page, see each change next to the action responsible, and decide what stays.</p></li>
</ol></section>`;

const sidebar = (p, current) => `<aside class="side" aria-label="Essays"><div class="side-in"><h2>Essays</h2>
<ul class="side-list">
${ESSAYS.map((e) => `<li${e.slug === current ? ' class="current"' : ""}><a href="${p}essays/${e.slug}.html"${e.slug === current ? ' aria-current="page"' : ""}><span class="t">${esc(e.label)}</span><span class="quiet">${esc(prettyDate(e.date))}${e.summary ? " &middot; " + esc(e.summary) : ""}</span></a></li>`).join("\n")}
</ul></div></aside>`;

// ---------- Build ----------
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "essays"), { recursive: true });
mkdirSync(join(OUT, "assets"), { recursive: true });
const write = (rel, s) => writeFileSync(join(OUT, rel), s);

const essays = readdirSync(SRC).filter((f) => f.endsWith(".md")).sort().map((f) => {
  const { meta, body } = frontMatter(readFileSync(join(SRC, f), "utf8"), f);
  const slug = f.replace(/\.md$/, "");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`${f}: slug must be lowercase letters, digits, hyphens`);
  // the essay's own leading "# Title" duplicates the page heading; skip it when it matches the front-matter title
  const lead = body.match(/^\s*#\s+(.*?)\s*#*\s*(\n|$)/);
  const text = lead && lead[1] === meta.title ? body.slice(lead[0].length) : body;
  const num = (slug.match(/^(\d+)-/) ?? [])[1];
  return { slug, ...meta, label: num === undefined ? meta.title : `${Number(num)}. ${meta.title}`, html: essayHtml(text, f) };
}).reverse(); // newest first by the filename's number prefix (0-, 1-, 2-...), not the date; lists show "<n>. <title>"
ESSAYS = essays;

for (const f of readdirSync(join(root, "assets"))) copyFileSync(join(root, "assets", f), join(OUT, "assets", f));

write("index.html", page({ title: "CoCheck: see what your AI agents changed", desc: "CoCheck shows what AI agents changed in your files, step by step, on a before-and-after review page.", body: homeBody(), base: "", nav: "home", path: "" }));
write("essays/index.html", page({ title: "Essays - CoCheck", desc: "Essays from the CoCheck project.", side: false, nav: "essays", path: "essays/", body: `<h1>Essays</h1>\n<ul class="list">\n${essayItems(essays.map((e) => ({ ...e, href: `${e.slug}.html` })))}\n</ul>`, base: "../" }));
for (const e of essays) {
  write(`essays/${e.slug}.html`, page({ title: `${e.title} - CoCheck`, desc: e.summary || e.title, base: "../", current: e.slug, nav: "essay", path: `essays/${e.slug}.html`, type: "article", body: `<article><h1>${esc(e.title)}</h1>\n<p class="meta"><time datetime="${esc(e.date)}">${esc(prettyDate(e.date))}</time></p>\n${e.html}</article>` }));
}
// GitHub Pages serves 404.html at any depth, so it links from the site root
write("404.html", page({ title: "Page not found - CoCheck", desc: "This page does not exist on cocheck.ai.", base: "/", side: false, body: `<section class="hero"><h1>Page not found</h1>
<p class="lede">There is nothing at this address. It may have moved, or the link may be wrong.</p>
<p><a href="/">Go to the home page</a> &middot; <a href="/essays/">Read the essays</a> &middot; <a href="${REPO}">CoCheck on GitHub</a></p></section>` }));
write("llms.txt", `# CoCheck

> CoCheck records what AI agents (Claude Code, Codex, Copilot) change in a person's files and shows every change on a local review page, before and after, with the agent action that made it. It runs on the person's own machine and sends nothing anywhere by default. It is a preview release: macOS, or Windows with Claude Code as a test build; Node 22.18 or newer.

Install on a Mac with \`brew install cocheck-ai/tap/cocheck\` or on a Mac or Windows with \`npm install -g cocheck\`, then run \`cocheck install --home ~/CoCheckData\` from the folder CoCheck should watch. \`--home\` is required, has no default, and must be an absolute path. Ask the person before installing. Where this file and docs/install.md disagree, docs/install.md wins.

## Docs

- [AGENTS.md](${RAW}/AGENTS.md): what CoCheck is, how it works, its state, and how to install and use it for a person
- [README](${RAW}/README.md): overview, the author's notes and known limits, install and use
- [Install guide](${RAW}/docs/install.md): install, start and stop tracking, the review page, uninstall, troubleshooting
- [Connector guide](${RAW}/public-kit/GUIDE.md): build a connector so CoCheck can read another file type or app
- [Connector standard v1](${RAW}/public-kit/spec/v1.md): the connector specification

## Optional

- [Repository](${REPO}): source code, issues and releases
- [Essays](${SITE}essays/): essays from the CoCheck project
`);
write("CNAME", "cocheck.ai\n");
write(".nojekyll", "");
console.log(`built ${essays.length} essay(s) + 2 pages, 404.html and llms.txt into docs/`);
