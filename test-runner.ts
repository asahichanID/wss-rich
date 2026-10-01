/**
 * Dedicated Test Runner Script
 * Tests real server socket and HTTP operations according to TEST WAJIB specification.
 */
import { runDiagnostics } from './src/server/diagnostics.js';

async function main() {
  // Try port 3000 first (dev server standard in AI Studio), then process.env.PORT, then 8080
  let targetPort = 3000;
  try {
    const checkRes = await fetch(`http://127.0.0.1:3000/health`);
    if (checkRes.ok) targetPort = 3000;
  } catch {
    if (process.env.PORT) {
      targetPort = parseInt(process.env.PORT, 10);
    }
  }
  console.log(`[TEST-RUNNER] Starting live tests against port ${targetPort}...`);

  try {
    const report = await runDiagnostics(targetPort, '127.0.0.1');

    console.log('\n================ TEST WAJIB EXECUTION RESULTS ================');
    report.results.forEach((r) => {
      console.log(`${r.passed ? '✓ [PASS]' : '✗ [FAIL]'} ${r.name} (${r.durationMs}ms)`);
      if (r.details) console.log(`    → ${r.details}`);
      if (r.error) console.log(`    → ERROR: ${r.error}`);
    });
    console.log('==============================================================');
    console.log(`Summary: ${report.passedTests} passed, ${report.failedTests} failed in ${report.durationMs}ms`);
    console.log(`Status : ${report.allPassed ? 'READY FOR WA RICH GAME' : 'FAILED'}\n`);

    if (!report.allPassed) {
      process.exit(1);
    }
  } catch (err: unknown) {
    console.error('[TEST-RUNNER] Fatal diagnostic error:', err);
    process.exit(1);
  }
}

main();
