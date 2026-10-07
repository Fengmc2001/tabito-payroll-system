import {createHash} from 'node:crypto';

export function assertBindingsMatch(config, bindings) {
  const wantedDb = config.d1_databases.find(item => item.binding === 'DB');
  const wantedFiles = config.r2_buckets.find(item => item.binding === 'FILES');
  const actualDb = bindings?.find(item => item.name === 'DB');
  const actualFiles = bindings?.find(item => item.name === 'FILES');
  if (actualDb?.type !== 'd1' || actualDb.id !== wantedDb.database_id
    || actualFiles?.type !== 'r2_bucket' || actualFiles.bucket_name !== wantedFiles.bucket_name
    || (actualFiles.jurisdiction || 'default') !== (wantedFiles.jurisdiction || 'default')) {
    throw new Error('Worker 的现有数据绑定与本地配置不一致。请恢复原 D1 ID 和 R2 存储桶，不要创建替代资源。');
  }
}

export function assertNoInterruptedReset(rows) {
  const keys = ['production_reset_20260906_v1', 'production_reset_20260913_v1'];
  for (const key of keys) {
    const phase = rows.find(row => row.key === key)?.value;
    const owner = rows.find(row => row.key === key + '_owner')?.value;
    if (['purging', 'clearing', 'cleared'].includes(phase) || (phase === 'pending' && owner)
      || (phase && !['pending', 'complete'].includes(phase))) {
      throw new Error('检测到旧版本尚未完成的重置或维护状态。已停止更新；请先核对备份并由管理员处理，不会自动清空或继续重置。');
    }
  }
}

export function assertPreservingMigrations(migrations) {
  for (const migration of migrations) {
    // Historical migrations are immutable. 0005 adds audit indexing; 0006
    // repairs reference indexes/invalid legacy states without clearing wages.
    // Wrangler's migration ledger prevents either from running again on update.
    const auditedLegacyHashes = {
      '0005_old_inertia.sql': '50f1e835da560408deb592f5fb6962c4a8301db1c3d169ad47fec363c881b0c0',
      '0006_dry_winter_soldier.sql': '9f2c58bd06837c6e72a213d15153b8537cdc0c5918e0ecdd4a4930b6e8e62b0f',
    };
    const legacy = auditedLegacyHashes[migration.name] === createHash('sha256').update(migration.sql.replace(/\r\n/g, '\n')).digest('hex');
    if (legacy) continue;
    const statements = migration.sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').split(';').map(item => item.trim()).filter(Boolean);
    for (const statement of statements) {
      if (!/^(CREATE\s+(TABLE|(?:UNIQUE\s+)?INDEX)\b|DROP\s+INDEX\b|ALTER\s+TABLE\s+[`"\w]+\s+ADD\b)/i.test(statement)) {
        throw new Error(`迁移 ${migration.name} 包含非增量语句，必须单独审阅；保留数据发布已停止。`);
      }
    }
  }
}

export async function runPreservingRelease(ops) {
  await ops.preflight();
  await ops.build();
  await ops.migrate();
  await ops.preflight();
  await ops.publish();
  return 'updated-without-reset';
}
