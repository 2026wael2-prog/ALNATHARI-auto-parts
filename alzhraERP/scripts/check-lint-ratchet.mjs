#!/usr/bin/env node
// حارس دين الـ lint المتدرج (ratchet) — نفس فلسفة check-ts-baseline.ts
//
// الوضع الافتراضي: يفحص ملفات TS/TSX المتغيرة في آخر commit (أو الممررة عبر --files=)
// ويقارن عدد أخطاء ESLint الحالية بالخط الأساسي (lint-baseline.json).
// يمنع نمو الدين الجديد دون أن يحاصر الدين البنيوي القديم المسجَّل.
//
// الاستخدام:
//   node scripts/check-lint-ratchet.mjs                       # git diff HEAD~1..HEAD
//   node scripts/check-lint-ratchet.mjs --files="a.ts b.tsx"  # ملفات محددة (CI)
//   node scripts/check-lint-ratchet.mjs --seed-all            # يعيد بناء الأساس لكل src
//   node scripts/check-lint-ratchet.mjs --update              # يحدّث الأساس بعد سداد دين مقصود
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BASELINE_PATH = path.join(HERE, 'lint-baseline.json');

const readBaseline = () => {
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  } catch {
    return {};
  }
};

const writeBaseline = b => {
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(b, null, 2) + '\n');
};

/** جذر المستودع — `git diff` يُخرج مسارات نسبةً إليه، بينما eslint يعمل من ROOT. */
const GIT_ROOT = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    return ROOT;
  }
})();

/**
 * يوحّد شكل المسار إلى نسبةٍ من ROOT.
 * بدون هذا التطبيع كان `git diff` يُخرج `alzhraERP/src/x.ts` بينما eslint يعمل
 * من `alzhraERP`، فيفشل على كل مسار وتُبتلع الأخطاء فتنجح البوابة دون فحص شيء.
 */
const toRootRelative = f => {
  const asIs = path.resolve(ROOT, f);
  if (fs.existsSync(asIs)) return path.relative(ROOT, asIs).split(path.sep).join('/');
  const fromGitRoot = path.resolve(GIT_ROOT, f);
  if (fs.existsSync(fromGitRoot)) {
    const r = path.relative(ROOT, fromGitRoot).split(path.sep).join('/');
    if (!r.startsWith('..')) return r;
  }
  return null;
};

const runEslint = files => {
  const eslintBin = path.join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');
  const results = [];

  // Windows command-line limit (~32K chars) does NOT fit ~1000 absolute paths
  // in a single spawn (ENAMETOOLONG). Split into batches of 200 files: each
  // batch is a single eslint process (fast), while total matches the size of
  // the argument one call would need.
  const BATCH = 200;
  for (let i = 0; i < files.length; i += BATCH) {
    const chunk = files.slice(i, i + BATCH);
    const res = spawnSync(
      process.execPath,
      [eslintBin, ...chunk.map(f => f.split(path.sep).join('/')), '--format', 'json'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }
    );
    const out = res.stdout || '';
    try {
      results.push(...JSON.parse(out));
    } catch (parseErr) {
      // The batch JSON is invalid (eslint crashed / stdout truncated) — log the
      // reason when asked, then process this batch's files one-by-one.
      if (res.error) {
        console.error(`[lint-ratchet] batch eslint failed (${res.error.message}) — falling back to per-file.`);
      } else if (process.env.LINT_RATCHET_DEBUG) {
        console.error(`[lint-ratchet] batch JSON parse failed (stdout ${out.length} chars) — falling back to per-file.`);
      }
      for (const f of chunk) {
        const single = spawnSync(
          process.execPath,
          [eslintBin, f.split(path.sep).join('/'), '--format', 'json'],
          { cwd: ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }
        );
        // eslint يُخرج `[]` للملف النظيف (exit 0/1)، أما exit >= 2 فهو فشل حقيقي
        // (مسار غير موجود، خطأ إعداد) ولا يجوز ابتلاعه وإسقاط الملف من الفحص.
        const failed = single.status === null || single.status >= 2;
        let parsed = null;
        if (!failed) {
          try {
            parsed = JSON.parse(single.stdout || '[]');
          } catch {
            parsed = null;
          }
        }
        if (Array.isArray(parsed)) {
          results.push(...parsed);
        } else {
          results.push({
            filePath: path.resolve(ROOT, f),
            errorCount: 999,
            messages: [
              {
                message: `eslint produced no usable report for "${f}" (exit ${String(single.status)}); the file was NOT checked`,
                severity: 2,
                ruleId: null,
              },
            ],
          });
        }
      }
    }
  }
  return results;
};

const rel = p => path.relative(ROOT, p).split(path.sep).join('/');

if (process.argv.includes('--seed-all')) {
  // يعيد بناء الأساس لكل الملفات مرة واحدة (خطوة تهيئة/سداد دين).
  // النطاق مقصور على src/ لتغطية كل ملفات التطبيق (بما فيها الملفات الجديدة
  // التي لن تجدها البطاقة القديمة) دون سحب e2e/scripts/test التي يستثنيها
  // eslint.config.js أصلاً (ستُسجل 0 أخطاء في كل الأحوال).
  const allFiles = execFileSync(
    'git',
    ['ls-files', '--', 'src/*.ts', 'src/*.tsx', 'src/**/*.ts', 'src/**/*.tsx'],
    { cwd: ROOT, encoding: 'utf8' }
  )
    .split('\n')
    .filter(Boolean);
  console.log(`[lint-ratchet] --seed-all: rebuilding baseline for ${allFiles.length} src files...`);
  const results = runEslint(allFiles);
  const baseline = {};
  for (const r of results) baseline[rel(r.filePath)] = r.errorCount || 0;
  writeBaseline(baseline);
  console.log(
    `[lint-ratchet] Seeded baseline: ${Object.keys(baseline).length} files, ${Object.values(baseline).reduce((a, b) => a + b, 0)} total errors.`
  );
  process.exit(0);
}

// تحديد الملفات المتغيرة
let files;
const filesFlag = process.argv.find(a => a.startsWith('--files='));
if (filesFlag) {
  files = filesFlag
    .slice(8)
    .split(/[\s,]+/)
    .filter(Boolean);
} else {
  try {
    const changed = execFileSync(
      'git',
      ['diff', '--name-only', 'HEAD~1', 'HEAD', '--', '*.ts', '*.tsx'],
      { cwd: ROOT, encoding: 'utf8' }
    )
      .split('\n')
      .filter(Boolean);
    files = changed;
  } catch {
    // أول commit أو لا أصل تاريخي — لا شيء للمقارنة به.
    console.log('[lint-ratchet] No base commit to diff against — skipping.');
    process.exit(0);
  }
}

files = files.filter(f => /\.(ts|tsx)$/.test(f));

// تطبيع المسارات قبل تمريرها إلى eslint (وإلا فحصت البوابة صفر ملفات بصمت).
const skipped = [];
files = files
  .map(f => {
    const rel = toRootRelative(f);
    if (rel === null) skipped.push(f);
    return rel;
  })
  .filter(f => f !== null);

if (skipped.length > 0) {
  console.log(`[lint-ratchet] skipped ${String(skipped.length)} missing file(s): ${skipped.join(', ')}`);
}

if (files.length === 0) {
  console.log('[lint-ratchet] No changed TS/TSX files.');
  process.exit(0);
}

const baseline = readBaseline();
const results = runEslint(files);

if (process.argv.includes('--update')) {
  for (const r of results) baseline[rel(r.filePath)] = r.errorCount || 0;
  writeBaseline(baseline);
  console.log(`[lint-ratchet] Baseline updated. ${results.length} files recorded.`);
  process.exit(0);
}

let failed = false;
for (const r of results) {
  const key = rel(r.filePath);
  const prev = baseline[key] ?? 0;
  const now = r.errorCount || 0;
  if (now > prev) {
    failed = true;
    console.error(`❌ ${key}: ${now} errors (baseline ${prev}) — new lint debt introduced.`);
    for (const m of (r.messages || []).filter(m => m.severity === 2)) {
      console.error(`   ${m.line}:${m.column}  ${m.ruleId}  ${m.message}`);
    }
  } else {
    console.log(`✓ ${key}: ${now} errors (baseline ${prev})`);
  }
}

if (failed) {
  console.error(
    '[lint-ratchet] FAILED: new lint debt detected. Fix it, or run --update ONLY when debt is intentionally paid down.'
  );
  process.exit(1);
}
console.log(`[lint-ratchet] OK: all ${results.length} changed files within lint baseline.`);
