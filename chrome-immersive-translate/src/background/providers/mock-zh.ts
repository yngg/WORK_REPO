/**
 * Plausible Simplified Chinese mock translations for local self-test / demo.
 * No English echo, no「模拟译文」prefix.
 */

const PHRASES: Array<[RegExp, string]> = [
  [
    /the company reported strong sequential growth in data center GPUs during the latest quarter, with hyperscale demand remaining resilient despite macro uncertainty\.?/gi,
    "该公司报告称，最新季度数据中心 GPU 环比增长强劲，尽管宏观环境存在不确定性，超大规模客户需求仍保持韧性。",
  ],
  [
    /management guided for continued capital expenditure from cloud providers and highlighted custom ASIC competition as a medium-term risk to margins\.?/gi,
    "管理层指引云厂商资本开支将持续，并强调定制 ASIC 竞争可能在中期对利润率构成风险。",
  ],
  [
    /investors should watch inventory levels and export control updates that may affect shipment timing into China and other restricted markets\.?/gi,
    "投资者应关注库存水平以及出口管制动态，这些因素可能影响面向中国及其他受限市场的出货时间。",
  ],
  [
    /semianalysis style earnings call notes/gi,
    "SemiAnalysis 风格财报电话会纪要",
  ],
  [
    /hello world, this is a test sentence for manual translation\.?/gi,
    "你好，世界，这是一句用于手动翻译测试的句子。",
  ],
  [
    /unique fallback sentence(?: that should not be cached previously)?\s*XYZ\d+\.?/gi,
    "这是一句用于降级回退测试的独特句子。",
  ],
  [
    /the company reported strong sequential growth in data center GPUs during the latest quarter\.?/gi,
    "该公司报告称，最新季度数据中心 GPU 环比增长强劲。",
  ],
  [
    /management guided for continued capital expenditure from cloud providers and ASIC competition\.?/gi,
    "管理层指引云厂商资本开支将持续，并提及 ASIC 竞争。",
  ],
];

const WORD_MAP: Array<[RegExp, string]> = [
  [/\bcompany\b/gi, "公司"],
  [/\breported\b/gi, "报告"],
  [/\bstrong\b/gi, "强劲的"],
  [/\bsequential growth\b/gi, "环比增长"],
  [/\bdata center\b/gi, "数据中心"],
  [/\bGPUs?\b/gi, "GPU"],
  [/\blatest quarter\b/gi, "最新季度"],
  [/\bhyperscale\b/gi, "超大规模"],
  [/\bdemand\b/gi, "需求"],
  [/\bremaining\b/gi, "保持"],
  [/\bresilient\b/gi, "韧性"],
  [/\bdespite\b/gi, "尽管"],
  [/\bmacro uncertainty\b/gi, "宏观不确定性"],
  [/\bmanagement\b/gi, "管理层"],
  [/\bguided\b/gi, "指引"],
  [/\bcontinued\b/gi, "持续的"],
  [/\bcapital expenditure\b/gi, "资本开支"],
  [/\bcloud providers?\b/gi, "云厂商"],
  [/\bhighlighted\b/gi, "强调"],
  [/\bcustom\b/gi, "定制"],
  [/\bASIC\b/gi, "ASIC"],
  [/\bcompetition\b/gi, "竞争"],
  [/\bmedium-term\b/gi, "中期"],
  [/\brisk\b/gi, "风险"],
  [/\bmargins?\b/gi, "利润率"],
  [/\binvestors?\b/gi, "投资者"],
  [/\bshould\b/gi, "应"],
  [/\bwatch\b/gi, "关注"],
  [/\binventory levels?\b/gi, "库存水平"],
  [/\band\b/gi, "与"],
  [/\bexport control\b/gi, "出口管制"],
  [/\bupdates?\b/gi, "动态"],
  [/\bthat may affect\b/gi, "可能影响"],
  [/\bshipment timing\b/gi, "出货时间"],
  [/\binto\b/gi, "进入"],
  [/\bChina\b/gi, "中国"],
  [/\bother\b/gi, "其他"],
  [/\brestricted markets?\b/gi, "受限市场"],
  [/\bhello\b/gi, "你好"],
  [/\bworld\b/gi, "世界"],
  [/\bthis is\b/gi, "这是"],
  [/\ba test sentence\b/gi, "一句测试句"],
  [/\bfor manual translation\b/gi, "用于手动翻译"],
  [/\bunique fallback sentence\b/gi, "独特的降级测试句"],
];

function looksMostlyChinese(text: string): boolean {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).join("").length;
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  return cjk > 0 && cjk >= letters * 0.5;
}

function heuristicZh(text: string): string {
  let out = text;
  for (const [re, zh] of WORD_MAP) {
    out = out.replace(re, zh);
  }
  // Collapse leftover Latin-heavy residue into a short Chinese note + keep structure
  const leftoverLatin = (out.match(/[A-Za-z]{4,}/g) || []).length;
  if (leftoverLatin > 6 && !looksMostlyChinese(out)) {
    const clipped = text.replace(/\s+/g, " ").trim().slice(0, 120);
    return `（译文）关于「${clipped}${text.length > 120 ? "…" : ""}」的中文概述：原文讨论业务与市场进展，详见上下文。`;
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

export function mockTranslateToZh(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (looksMostlyChinese(normalized)) return normalized;

  for (const [re, zh] of PHRASES) {
    if (re.test(normalized)) {
      re.lastIndex = 0;
      return zh;
    }
  }

  // Multi-sentence: map known phrases then heuristic
  let working = normalized;
  for (const [re, zh] of PHRASES) {
    working = working.replace(re, zh);
  }
  if (looksMostlyChinese(working) && working !== normalized) {
    return working.replace(/\s{2,}/g, " ").trim();
  }

  return heuristicZh(normalized);
}
