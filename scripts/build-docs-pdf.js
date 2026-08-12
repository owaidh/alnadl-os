// scripts/build-docs-pdf.js
// Converts every handover markdown document into a branded, professionally
// typeset PDF under docs/pdf/. This is a documentation build tool, not part
// of the running application — it requires `marked` and `playwright`
// (both dev-only tools, not runtime dependencies of server.js).
//
// Usage: node scripts/build-docs-pdf.js
'use strict';
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'pdf');
fs.mkdirSync(OUT_DIR, { recursive: true });

const DOCS = [
  { file: 'README.md', category: 'دليل المشروع · Project Guide' },
  { file: 'HANDOVER.md', category: 'التسليم الفني النهائي · Final Handover' },
  { file: 'docs/MASTER_REQUIREMENTS.md', category: 'المتطلبات · Requirements' },
  { file: 'docs/PRD.md', category: 'المتطلبات · Requirements' },
  { file: 'docs/ARCHITECTURE.md', category: 'مرجع تقني · Technical Reference' },
  { file: 'docs/API_DOCUMENTATION.md', category: 'مرجع تقني · Technical Reference' },
  { file: 'docs/DATABASE_SCHEMA.md', category: 'مرجع تقني · Technical Reference' },
  { file: 'docs/UX_UI_SPEC.md', category: 'تصميم · Design' },
  { file: 'docs/USER_FLOWS.md', category: 'تصميم · Design' },
  { file: 'docs/QR_SITE_MAPPING_SPEC.md', category: 'مواصفة فنية · Technical Spec' },
  { file: 'docs/PACKAGES_FEATURE_FLAGS_MATRIX.md', category: 'مواصفة فنية · Technical Spec' },
  { file: 'docs/MULTI_OUTLET_SPEC.md', category: 'مواصفة فنية · Technical Spec' },
  { file: 'docs/REVENUE_MODEL_SPEC.md', category: 'مواصفة فنية · Technical Spec' },
  { file: 'docs/WHITE_LABEL_SPEC.md', category: 'مواصفة فنية · Technical Spec' },
  { file: 'docs/ROLES_PERMISSIONS_MATRIX.md', category: 'أمن المعلومات · Security' },
  { file: 'docs/DEPLOYMENT.md', category: 'دليل تشغيلي · Operations Guide' },
  { file: 'docs/TEST_PLAN.md', category: 'ضمان الجودة · Quality Assurance' },
  { file: 'docs/RUNBOOK.md', category: 'دليل تشغيلي · Operations Guide' },
  { file: 'docs/TRAINING.md', category: 'دليل تدريب · Training Guide' },
  { file: 'docs/CREDENTIALS.md', category: 'أمن المعلومات · Security' },
  { file: 'docs/WARRANTY_CLAUSE_TEMPLATE.md', category: 'نموذج تعاقدي · Contract Template' },
  { file: 'docs/PHASE4_GAP_ANALYSIS.md', category: 'تحليل فني · Technical Analysis', landscape: true },
  { file: 'docs/PHASE5_GAP_ANALYSIS.md', category: 'تحليل فني · Technical Analysis (DRAFT)' },
  { file: 'docs/GAP_REGISTER.md', category: 'سجل الفجوات · Gap Register', landscape: true },
  { file: 'docs/CHANGELOG.md', category: 'سجل الإصدارات · Release Notes' },
];

const CSS = `
  @font-face { font-family: 'DocBody'; src: local('DejaVu Sans'); }
  :root{
    --ink-950:#14110E; --ink-800:#241F17; --ink-600:#544731; --ink-400:#8A7C63; --ink-200:#D8CFB9;
    --brass-500:#C08A3E; --brass-600:#A6752F; --brass-100:#F3E6CE;
    --cream:#FEFCF9; --sage:#3F7D58; --sage-bg:#E4EFE7; --amber:#A15A0E; --amber-bg:#F6E7D3; --red:#8C2E28; --red-bg:#F5E1DF;
    --line:#E7DFCB;
  }
  *{ box-sizing:border-box; }
  html,body{ margin:0; padding:0; }
  body{
    font-family:'DejaVu Sans','FreeSans',sans-serif;
    color:var(--ink-950); background:var(--cream);
    font-size:13.5px; line-height:1.85;
  }
  .titleblock{
    padding:0 0 22px; margin-bottom:26px; border-bottom:3px solid var(--brass-500);
  }
  .titleblock .eyebrow{
    display:inline-block; font-size:11px; font-weight:700; color:var(--brass-600);
    background:var(--brass-100); padding:4px 12px; border-radius:999px; margin-bottom:14px;
    letter-spacing:.02em;
  }
  .titleblock h1{ font-size:26px; margin:0 0 6px; font-weight:700; color:var(--ink-950); }
  .titleblock .meta{ font-size:11.5px; color:var(--ink-400); }
  h1{ font-size:20px; margin:32px 0 14px; padding-top:6px; color:var(--ink-950); border-top:1px solid var(--line); padding-top:18px;}
  body > h1:first-of-type{ display:none; } /* the markdown's own H1 is replaced by titleblock */
  h2{ font-size:16px; margin:26px 0 10px; color:var(--brass-600); font-weight:700; }
  h3{ font-size:14px; margin:18px 0 8px; color:var(--ink-800); font-weight:700; }
  p{ margin:0 0 12px; }
  ul,ol{ margin:0 0 14px; padding-inline-start:22px; }
  li{ margin-bottom:5px; }
  a{ color:var(--brass-600); }
  strong{ color:var(--ink-950); }
  hr{ border:none; border-top:1px solid var(--line); margin:26px 0; }
  table{ border-collapse:collapse; width:100%; table-layout:fixed; margin:12px 0 20px; font-size:11px; }
  th{ background:var(--ink-950); color:var(--cream); text-align:start; padding:8px 10px; font-weight:700; font-size:10px; overflow-wrap:break-word; }
  td{ padding:7px 10px; border-bottom:1px solid var(--line); vertical-align:top; overflow-wrap:break-word; word-break:break-word; }
  tr:nth-child(even) td{ background:#FBF7EF; }
  code{ font-family:'Liberation Mono',monospace; unicode-bidi:plaintext; background:var(--brass-100); color:var(--ink-800); padding:1px 5px; border-radius:4px; font-size:9.5px; word-break:break-word; white-space:pre-wrap; }
  pre{ unicode-bidi:plaintext; text-align:start; background:var(--ink-950); color:#F3ECDD; padding:14px 16px; border-radius:8px; overflow-x:auto; margin:12px 0 18px; font-size:11.5px; }
  pre code{ background:none; color:inherit; padding:0; }
  blockquote{ margin:14px 0; padding:10px 16px; border-inline-start:4px solid var(--brass-500); background:var(--brass-100); border-radius:0 6px 6px 0; }
  .callout-warn{ background:var(--amber-bg); border-inline-start:4px solid var(--amber); padding:10px 16px; border-radius:0 6px 6px 0; margin:14px 0; }
`;

function htmlEscape(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function buildHtml(mdPath, category) {
  const raw = fs.readFileSync(path.join(ROOT, mdPath), 'utf8');
  const firstH1Match = raw.match(/^#\s+(.+)$/m);
  const title = firstH1Match ? firstH1Match[1].replace(/[#`]/g, '').trim() : path.basename(mdPath);
  const bodyHtml = marked.parse(raw);
  const isRtl = /[\u0600-\u06FF]/.test(raw.slice(0, 400)); // detect Arabic in the opening of the doc

  return `<!DOCTYPE html>
<html lang="${isRtl ? 'ar' : 'en'}" dir="${isRtl ? 'rtl' : 'ltr'}">
<head><meta charset="utf-8"><style>${CSS}</style></head>
<body>
  <div class="titleblock">
    <span class="eyebrow">${htmlEscape(category)}</span>
    <h1>${htmlEscape(title)}</h1>
    <div class="meta">Alnadl Hospitality OS — ${path.basename(mdPath)}</div>
  </div>
  ${bodyHtml}
</body>
</html>`;
}

const HEADER_TEMPLATE = `
<div style="width:100%; font-size:8px; font-family:'DejaVu Sans',sans-serif; color:#8A7C63; padding:0 38px; display:flex; justify-content:space-between; align-items:center;">
  <span style="font-weight:700; color:#14110E;">ن&nbsp; ALNADL Hospitality OS</span>
  <span></span>
</div>`;
const FOOTER_TEMPLATE = `
<div style="width:100%; font-size:8px; font-family:'DejaVu Sans',sans-serif; color:#8A7C63; padding:0 38px; display:flex; justify-content:space-between; align-items:center; border-top:1px solid #E7DFCB; padding-top:4px;">
  <span>سري — للمراجعة الداخلية فقط · Internal review only</span>
  <span>صفحة <span class="pageNumber"></span> / <span class="totalPages"></span></span>
</div>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const { file, category, landscape } of DOCS) {
    const html = buildHtml(file, category);
    const tmp = path.join(OUT_DIR, '_tmp.html');
    fs.writeFileSync(tmp, html);
    await page.goto('file://' + tmp);
    const outName = path.basename(file, '.md') + '.pdf';
    await page.pdf({
      path: path.join(OUT_DIR, outName),
      format: 'A4',
      landscape: !!landscape,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: HEADER_TEMPLATE,
      footerTemplate: FOOTER_TEMPLATE,
      margin: { top: '22mm', bottom: '18mm', left: '16mm', right: '16mm' },
    });
    console.log('built', outName);
  }
  fs.unlinkSync(path.join(OUT_DIR, '_tmp.html'));
  await browser.close();
})();
