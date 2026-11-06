#!/usr/bin/env node
/*
 * Genera un manifiesto verificable de una candidata a release. No despliega,
 * no cambia alias y no lee secretos. Ejemplo:
 * node tools/generate-version-manifest.js --frontend ..\\YARBI_LATEST_CRM_PHASE2_BUILD_2026-09-15\\www\\index.html --apk ..\\Yarbi_APPDEBUG_3.4.25_WhatsApp_Directo_Estados_20261026.apk --out ..\\AUDITORIA_YARBI_INTEGRAL_20261027\\FASE1A_MANIFIESTO_VERSIONS_20261027.json
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const yauzl = require('yauzl');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}
function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function requiredFile(value, label) {
  const file = path.resolve(value || '');
  if (!value || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`Falta ${label}: ${value || '(sin ruta)'}`);
  return file;
}
function migrationInventory(root) {
  const dir = path.join(root, 'migrations');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => /\.sql$/i.test(name)).sort().map(name => {
    const file = path.join(dir, name);
    return { file: `migrations/${name}`, sha256: sha256(file), bytes: fs.statSync(file).size };
  });
}
function backendInventory(root) {
  const files = [
    'vercel.json', 'proxy.mjs', 'api/webhook.js', 'api/ai/process.js',
    'api/assistant/chat.js', 'api/assistant/preferences.js', 'api/audit/trace.js',
    'lib/yarbi-trace.js', 'lib/preview-audit-policy.js', 'lib/preview-audit-synthetic.js'
  ];
  return files.map(file => {
    const absolute = path.join(root, file);
    return fs.existsSync(absolute) && fs.statSync(absolute).isFile()
      ? { file, sha256: sha256(absolute), bytes: fs.statSync(absolute).size }
      : { file, present: false };
  });
}
function optionalJson(value, label) {
  if (!value) return null;
  const file = path.resolve(value);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`Falta ${label}: ${value}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function apkEntryDigest(apk, expectedEntry) {
  return new Promise((resolve, reject) => {
    yauzl.open(apk, { lazyEntries: true, autoClose: false }, (openError, zip) => {
      if (openError) return reject(openError);
      let settled = false;
      const fail = error => {
        if (settled) return;
        settled = true;
        try { zip.close(); } catch (_) { /* noop */ }
        reject(error);
      };
      zip.on('error', fail);
      zip.on('entry', entry => {
        if (entry.fileName !== expectedEntry) return zip.readEntry();
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return fail(streamError);
          const digest = crypto.createHash('sha256');
          let bytes = 0;
          stream.on('data', chunk => { digest.update(chunk); bytes += chunk.length; });
          stream.on('error', fail);
          stream.on('end', () => {
            if (settled) return;
            settled = true;
            try { zip.close(); } catch (_) { /* noop */ }
            resolve({ entry: entry.fileName, sha256: digest.digest('hex'), bytes });
          });
        });
      });
      zip.on('end', () => fail(new Error(`No existe ${expectedEntry} dentro del APK`)));
      zip.readEntry();
    });
  });
}

async function main() {
  // --frontend queda como alias de transición para un archivo fuente; nunca se
  // usa para afirmar qué HTML contiene el APK. El contenido empaquetado se lee
  // directamente desde el ZIP/APK y se hashea en memoria.
  const frontend = requiredFile(argument('--frontend-source') || argument('--frontend'), 'el frontend fuente del workspace');
  const apk = requiredFile(argument('--apk'), 'el APK');
  const apkEntry = String(argument('--apk-frontend-entry') || 'assets/public/index.html').replace(/^[/\\]+/, '');
  const backendRoot = path.resolve(argument('--backend-root') || process.cwd());
  const backendConfig = requiredFile(path.join(backendRoot, 'vercel.json'), 'vercel.json del backend');
  const output = path.resolve(argument('--out') || path.join(backendRoot, 'VERSION_MANIFEST.json'));
  const embeddedFrontend = await apkEntryDigest(apk, apkEntry);
  const manifest = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    generator: 'generate-version-manifest.js',
    components: {
      apk: {
        file: path.basename(apk),
        version_name: String(argument('--apk-version') || '').trim() || null,
        version_code: Number.parseInt(argument('--apk-version-code'), 10) || null,
        sha256: sha256(apk),
        bytes: fs.statSync(apk).size,
        embedded_frontend: embeddedFrontend
      },
      frontend_source_workspace: {
        file: frontend,
        sha256: sha256(frontend),
        bytes: fs.statSync(frontend).size,
        relationship_to_apk: sha256(frontend) === embeddedFrontend.sha256 ? 'matches_embedded_frontend' : 'does_not_match_embedded_frontend'
      },
      frontend_reference_copies: optionalJson(argument('--frontend-references-evidence'), 'la evidencia de copias de frontend') || [],
      // Estas huellas pertenecen al directorio local candidato. Nunca se usan
      // como prueba de que el deployment remoto ejecuta el mismo código.
      local_backend_candidate: {
        root: path.basename(backendRoot),
        vercel_config_sha256: sha256(backendConfig),
        tracked_files: backendInventory(backendRoot)
      },
      // La evidencia de deployment se recibe por separado, desde una lectura
      // verificable de Vercel. Sin esa evidencia, queda expresamente parcial.
      deployment_identity: {
        deployment_id: String(argument('--deployment-id') || '').trim() || null,
        deployment_url: String(argument('--deployment-url') || '').trim() || null,
        alias: String(argument('--alias') || '').trim() || null,
        code_verification: optionalJson(argument('--deployment-evidence'), 'la evidencia del deployment') || {
          status: 'not_verified',
          reason: 'local_hashes_are_not_deployment_proof'
        }
      },
      migrations: {
        local_inventory: migrationInventory(backendRoot),
        applied_evidence: optionalJson(argument('--applied-migrations-evidence'), 'la evidencia de migraciones aplicadas') || {
          status: 'not_verified'
        }
      }
    },
    notes: [
      'El manifiesto describe evidencia; no cambia alias de Vercel.',
      'Los hashes de local_backend_candidate no prueban el código del deployment remoto.',
      'El frontend empaquetado se obtuvo directamente de assets/public/index.html dentro del APK.',
      'No contiene claves, tokens, teléfonos ni conversaciones.'
    ]
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n');
  process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
}

main().catch(error => {
  process.stderr.write(`version_manifest_failed: ${String(error.message || error)}\n`);
  process.exitCode = 1;
});
