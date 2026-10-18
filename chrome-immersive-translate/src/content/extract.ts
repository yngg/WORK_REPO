import { MIN_PARAGRAPH_CHARS } from "../shared/types";

const EXCLUDE_TAGS = new Set([
  "NAV",
  "ASIDE",
  "FOOTER",
  "HEADER",
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "IFRAME",
  "SVG",
  "BUTTON",
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "FORM",
  "FIGURE",
  "FIGCAPTION",
]);

const EXCLUDE_RE =
  /\b(ad|ads|advert|sponsor|sidebar|menu|cookie|banner|promo|related|comment|footer|nav|share|social|newsletter|popup|modal|toolbar)\b/i;

const SITE_HINTS: Array<{ host: RegExp; selectors: string[] }> = [
  {
    host: /semianalysis\.com$/i,
    selectors: ["article", ".post-content", ".entry-content", "main"],
  },
  {
    host: /seekingalpha\.com$/i,
    selectors: ["article", "[data-test-id='article-content']", ".sa-art", "main"],
  },
  {
    host: /investing\.com$/i,
    selectors: ["article", ".articlePage", "#article", ".WYSIWYG", "main"],
  },
  {
    host: /sec\.gov$/i,
    selectors: ["#main-content", ".article-body", "article", "main", "body"],
  },
  {
    host: /edgar/i,
    selectors: ["#main-content", "article", "main"],
  },
  {
    host: /(ir\.|investor)/i,
    selectors: [".transcript", ".article-body", "article", "main", ".content"],
  },
];

const BLOCK_SELECTOR =
  "p, li, blockquote, h1, h2, h3, h4, h5, h6, pre, td, .transcript p, [class*='paragraph']";

export interface ExtractedParagraph {
  id: string;
  el: HTMLElement;
  text: string;
}

let idCounter = 0;

function nextId(): string {
  idCounter += 1;
  return `imt-p-${idCounter}`;
}

function isExcluded(el: Element): boolean {
  if (EXCLUDE_TAGS.has(el.tagName)) return true;
  if (el.closest("[data-imt-translation],[data-imt-placeholder],[data-imt-root]")) return true;
  const idClass = `${el.id} ${el.className}`;
  if (typeof idClass === "string" && EXCLUDE_RE.test(idClass)) return true;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return true;
  }
  return false;
}

function findRoot(): Element {
  const host = location.hostname;
  for (const hint of SITE_HINTS) {
    if (hint.host.test(host)) {
      for (const sel of hint.selectors) {
        const node = document.querySelector(sel);
        if (node && (node.textContent?.trim().length ?? 0) > 200) return node;
      }
    }
  }

  const semantic = ["article", "main", "[role=main]", ".post", ".article-body", ".content", ".transcript"];
  let best: Element | null = null;
  let bestScore = 0;
  for (const sel of semantic) {
    for (const node of document.querySelectorAll(sel)) {
      if (isExcluded(node)) continue;
      const len = node.textContent?.trim().length ?? 0;
      if (len > bestScore) {
        bestScore = len;
        best = node;
      }
    }
  }
  if (best && bestScore > 300) return best;
  return document.body;
}

function hasSentencePunctuation(text: string): boolean {
  return /[。.！？!?；;…]/.test(text) || /[.!?]/.test(text);
}

function shouldSkipText(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length < MIN_PARAGRAPH_CHARS && !hasSentencePunctuation(t)) return true;
  if (t.length < 8) return true;
  // Mostly links / navigation crumbs
  if (/^(home|menu|skip to|sign in|log in|subscribe)/i.test(t)) return true;
  return false;
}

function isMostlyLinks(el: HTMLElement): boolean {
  const links = el.querySelectorAll("a");
  if (links.length === 0) return false;
  const linkText = Array.from(links)
    .map((a) => a.textContent ?? "")
    .join("").length;
  const total = el.textContent?.length ?? 1;
  return linkText / total > 0.7 && total < 120;
}

export function extractParagraphs(root?: Element): ExtractedParagraph[] {
  const scope = root ?? findRoot();
  const nodes = scope.querySelectorAll(BLOCK_SELECTOR);
  const results: ExtractedParagraph[] = [];
  const seen = new WeakSet<HTMLElement>();

  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue;
    if (seen.has(node)) continue;
    if (isExcluded(node)) continue;
    if (node.closest("nav, aside, footer, header, [role=navigation], [role=complementary]")) {
      continue;
    }
    if (isMostlyLinks(node)) continue;
    // Skip if already has our translation as next sibling managed
    if (node.dataset.imtId) {
      const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
      if (!shouldSkipText(text)) {
        results.push({ id: node.dataset.imtId, el: node, text });
        seen.add(node);
      }
      continue;
    }

    const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
    if (shouldSkipText(text)) continue;

    // Avoid nested: if parent already in results with same text path, skip children of paragraph
    if (node.parentElement?.closest("[data-imt-id]") && node.tagName !== "LI") continue;

    const id = nextId();
    node.dataset.imtId = id;
    results.push({ id, el: node, text });
    seen.add(node);
  }

  return results;
}

export function isInViewport(el: Element, margin = 200): boolean {
  const rect = el.getBoundingClientRect();
  return rect.bottom >= -margin && rect.top <= window.innerHeight + margin;
}
