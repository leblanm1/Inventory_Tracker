import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

const gitBin = process.platform === "win32" ? "git.exe" : "git";
const GIT_ARCHIVE_REL_DIR = path.join("backups", "git-archives");
const SAFE_MAX_BYTES = 95 * 1024 * 1024;

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
    ...opts
  }).trim();
}

function runLogged(cmd, args, opts = {}) {
  const output = run(cmd, args, opts);
  if (output) console.log(output);
  return output;
}

function runNpmScript(scriptName, opts = {}) {
  if (process.platform === "win32") {
    return runLogged("cmd.exe", ["/d", "/s", "/c", `npm run ${scriptName}`], opts);
  }
  return runLogged("npm", ["run", scriptName], opts);
}

function tryRun(cmd, args, opts = {}) {
  try {
    return { ok: true, output: run(cmd, args, opts) };
  } catch (error) {
    return {
      ok: false,
      output: String(error?.stdout || "") + String(error?.stderr || "")
    };
  }
}

function utcDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function buildChildEnv(overrides = {}) {
  const base = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("=") && typeof value === "string") {
      base[key] = value;
    }
  }
  return { ...base, ...overrides };
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function writeGitSafeArtifact(rawFilePath, archiveDir) {
  const sourceFile = path.basename(rawFilePath);
  const rawContent = readFileSync(rawFilePath);
  const gzContent = gzipSync(rawContent, { level: 9 });
  const baseName = `${sourceFile}.gz`;
  const parts = [];

  if (gzContent.length <= SAFE_MAX_BYTES) {
    const outPath = path.join(archiveDir, baseName);
    writeFileSync(outPath, gzContent);
    parts.push(path.basename(outPath));
  } else {
    let offset = 0;
    let index = 1;
    while (offset < gzContent.length) {
      const part = gzContent.subarray(offset, offset + SAFE_MAX_BYTES);
      const partName = `${baseName}.part${String(index).padStart(3, "0")}`;
      writeFileSync(path.join(archiveDir, partName), part);
      parts.push(partName);
      offset += SAFE_MAX_BYTES;
      index += 1;
    }
  }

  const meta = {
    sourceFile,
    createdAt: new Date().toISOString(),
    sha256Raw: sha256(rawContent),
    sha256Gzip: sha256(gzContent),
    rawBytes: rawContent.length,
    gzipBytes: gzContent.length,
    chunked: parts.length > 1,
    parts
  };
  writeFileSync(path.join(archiveDir, `${sourceFile}.meta.json`), `${JSON.stringify(meta, null, 2)}\n`);
}

function createGitArchivesForToday(dateStamp, immutableBackupDir, gitArchiveDir) {
  mkdirSync(gitArchiveDir, { recursive: true });

  const rawFiles = [
    path.join(immutableBackupDir, `inventory-${dateStamp}.json`),
    path.join(immutableBackupDir, `inventory-${dateStamp}.xlsx`),
    path.join(immutableBackupDir, "manifest.jsonl")
  ];

  // Keep the archive folder append-only by date, but refresh today's generated files if rerun.
  for (const entry of rawFiles) {
    const source = path.basename(entry);
    rmSync(path.join(gitArchiveDir, `${source}.gz`), { force: true });
    rmSync(path.join(gitArchiveDir, `${source}.meta.json`), { force: true });
  }
  for (let i = 1; i < 1000; i += 1) {
    rmSync(path.join(gitArchiveDir, `inventory-${dateStamp}.json.gz.part${String(i).padStart(3, "0")}`), { force: true });
    rmSync(path.join(gitArchiveDir, `inventory-${dateStamp}.xlsx.gz.part${String(i).padStart(3, "0")}`), { force: true });
  }

  rawFiles.forEach((rawFilePath) => writeGitSafeArtifact(rawFilePath, gitArchiveDir));
}

const repoRoot = process.cwd();
const remoteName = process.env.BACKUP_GIT_REMOTE || "origin";
const backupBranch = process.env.BACKUP_GIT_BRANCH || "backup-archives";
const worktreePath = path.join(os.tmpdir(), `inventory-backup-worktree-${Date.now()}`);
const backupDirInWorktree = path.join(worktreePath, "backups", "immutable-backups");
const gitArchiveDirInWorktree = path.join(worktreePath, GIT_ARCHIVE_REL_DIR);

let worktreeCreated = false;

try {
  console.log(`Using repository: ${repoRoot}`);
  console.log(`Preparing backup branch '${backupBranch}' on remote '${remoteName}'...`);

  runLogged(gitBin, ["fetch", remoteName], { cwd: repoRoot });

  const remoteBranchCheck = tryRun(
    gitBin,
    ["ls-remote", "--heads", remoteName, backupBranch],
    { cwd: repoRoot }
  );
  const remoteBranchExists = remoteBranchCheck.ok && Boolean(remoteBranchCheck.output.trim());
  const localBranchExists = tryRun(
    gitBin,
    ["show-ref", "--verify", `refs/heads/${backupBranch}`],
    { cwd: repoRoot }
  ).ok;

  if (localBranchExists) {
    runLogged(gitBin, ["worktree", "add", worktreePath, backupBranch], {
      cwd: repoRoot
    });
  } else if (remoteBranchExists) {
    runLogged(gitBin, ["worktree", "add", "--detach", worktreePath, `${remoteName}/${backupBranch}`], {
      cwd: repoRoot
    });
    runLogged(gitBin, ["checkout", "-B", backupBranch], { cwd: worktreePath });
  } else {
    runLogged(gitBin, ["worktree", "add", "-b", backupBranch, worktreePath, "HEAD"], {
      cwd: repoRoot
    });
  }
  worktreeCreated = true;

  console.log("Generating today's immutable backups in the backup branch worktree...");
  runNpmScript("backup:now", {
    cwd: repoRoot,
    env: buildChildEnv({ INVENTORY_IMMUTABLE_BACKUP_DIR: backupDirInWorktree })
  });

  createGitArchivesForToday(utcDateStamp(), backupDirInWorktree, gitArchiveDirInWorktree);

  runLogged(gitBin, ["add", "--", GIT_ARCHIVE_REL_DIR], { cwd: worktreePath });

  const diffCheck = tryRun(gitBin, ["diff", "--cached", "--quiet"], { cwd: worktreePath });
  if (diffCheck.ok) {
    console.log("No new backup files to commit for today.");
    if (!remoteBranchExists) {
      runLogged(gitBin, ["push", remoteName, `${backupBranch}:${backupBranch}`], { cwd: worktreePath });
      console.log("Initialized remote backup branch.");
    }
  } else {
    const commitMessage = `chore(backup): immutable inventory backup archive ${utcDateStamp()}`;
    runLogged(gitBin, ["commit", "-m", commitMessage], { cwd: worktreePath });
    runLogged(gitBin, ["push", remoteName, `${backupBranch}:${backupBranch}`], { cwd: worktreePath });
    console.log("Backup commit pushed successfully.");
  }
} finally {
  if (worktreeCreated) {
    try {
      runLogged(gitBin, ["worktree", "remove", worktreePath, "--force"], { cwd: repoRoot });
    } catch (cleanupError) {
      console.warn("Warning: failed to clean up temporary worktree.");
      console.warn(String(cleanupError));
    }
  }
}
