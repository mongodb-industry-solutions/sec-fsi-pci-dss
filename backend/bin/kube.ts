import { execSync, spawnSync } from "child_process";
import { createInterface } from "readline";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, join, dirname } from "path";
import { homedir, platform } from "os";
import * as dotenv from "dotenv";

// -- Resolve project root (works from any cwd) --
function findProjectRoot(): string {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    let dir = resolve(__dirname, "../..");
    while (dir !== dirname(dir)) {
      if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "backend"))) return dir;
      dir = dirname(dir);
    }
    return resolve(__dirname, "../..");
  }
}

const PROJECT_ROOT = findProjectRoot();
const ENV_PATH = join(PROJECT_ROOT, ".env");
if (existsSync(ENV_PATH)) dotenv.config({ path: ENV_PATH });

// -- Constants --
const IST_NAMESPACE = "industrysolutions";
const ECR_REGISTRY = "795250896452.dkr.ecr.us-east-1.amazonaws.com";
const STAGING_API = "https://api.staging.corp.mongodb.com";
const PROD_API = "https://api.prod.corp.mongodb.com";
const HELM_REPO_NAME = "mongodb";
const HELM_REPO_URL = "https://10gen.github.io/helm-charts";
const HELM_CHART_VERSION = "4.25.0";
const DRONE_URL = "https://drone.corp.mongodb.com";

const DEMO_NAME = "sec-fsi-pci-dss";
const RELEASE_BACKEND = `${DEMO_NAME}-backend`;
const RELEASE_FRONTEND = `${DEMO_NAME}-frontend`;
const KSEC_SECRET_STAGING = `${DEMO_NAME}-secrets-staging`;
const KSEC_SECRET_PROD = `${DEMO_NAME}-secrets-prod`;

const STAGING_HOST_BE = `${RELEASE_BACKEND}.${IST_NAMESPACE}.staging.corp.mongodb.com`;
const STAGING_HOST_FE = `${RELEASE_FRONTEND}.${IST_NAMESPACE}.staging.corp.mongodb.com`;
const PROD_HOST_BE = `${RELEASE_BACKEND}.${IST_NAMESPACE}.prod.corp.mongodb.com`;
const PROD_HOST_FE = `${RELEASE_FRONTEND}.${IST_NAMESPACE}.prod.corp.mongodb.com`;

const HOME = homedir();
const IS_WIN = platform() === "win32";
const KANOPY_CONFIG_PATH = IS_WIN
  ? join(HOME, ".kanopy", "config.yaml")
  : join(HOME, ".kanopy", "config.yaml");
const KUBE_DIR = join(HOME, ".kube");

// -- Helpers --
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[90m";
const NC = "\x1b[0m";

function ok(msg: string) { console.log(`${GREEN}[ok]${NC}     ${msg}`); }
function warn(msg: string) { console.log(`${YELLOW}[warn]${NC}   ${msg}`); }
function fail(msg: string) { console.log(`${RED}[error]${NC}  ${msg}`); }
function action(msg: string) { console.log(`${CYAN}[action]${NC} ${msg}`); }
function chk(msg: string) { console.log(`[check]  ${msg}`); }

function run(cmd: string, opts?: { silent?: boolean }): string {
  if (!opts?.silent) console.log(`${DIM}[cmd]    ${cmd}${NC}`);
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: opts?.silent ? "pipe" : "inherit" }) || "";
  } catch (e: any) {
    return e.stdout || e.stderr || "";
  }
}

function runCapture(cmd: string): { stdout: string; status: number } {
  console.log(`${DIM}[cmd]    ${cmd}${NC}`);
  const result = spawnSync(cmd, { shell: true, encoding: "utf-8" });
  return { stdout: (result.stdout || "") + (result.stderr || ""), status: result.status || 0 };
}

function hasCommand(name: string): boolean {
  try {
    const cmd = IS_WIN ? `where ${name}` : `which ${name}`;
    execSync(cmd, { stdio: "pipe" });
    return true;
  } catch { return false; }
}

// -- Readline --
const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, (answer) => resolve(answer.trim())));
}

function pause(): Promise<void> {
  return new Promise((resolve) => rl.question("\nPress Enter to return to menu...", () => resolve()));
}

// ============================================================
//  1. SETUP
// ============================================================

async function installKubectl() {
  chk("kubectl...");
  if (hasCommand("kubectl")) { ok("kubectl is available."); return; }
  if (IS_WIN) {
    action("Installing kubectl via winget...");
    run("winget install --id Kubernetes.kubectl --silent --accept-package-agreements --accept-source-agreements");
  } else {
    action("Installing kubectl via brew...");
    run("brew install kubectl");
  }
  hasCommand("kubectl") ? ok("kubectl installed.") : fail("Could not install kubectl. Install manually.");
}

async function installHelm() {
  chk("Helm...");
  if (hasCommand("helm")) { ok("Helm is available."); return; }
  if (IS_WIN) {
    action("Installing Helm via winget...");
    run("winget install --id Helm.Helm --silent --accept-package-agreements --accept-source-agreements");
  } else {
    action("Installing Helm via brew...");
    run("brew install helm");
  }
  hasCommand("helm") ? ok("Helm installed.") : fail("Could not install Helm. Install manually.");
}

async function installKanopyOidc() {
  chk("kanopy-oidc...");
  if (hasCommand("kanopy-oidc")) { ok("kanopy-oidc is available."); return; }
  console.log("");
  warn("kanopy-oidc is not installed.");
  console.log("  Manual steps:");
  console.log("  1. Download from: https://github.com/kanopy-platform/kanopy-oidc/releases/");
  if (IS_WIN) {
    console.log("     - Windows: kanopy-oidc-windows-amd64-v0.5.3.zip");
  } else {
    console.log("     - macOS ARM64: kanopy-oidc-macos-arm64-v0.5.3.tgz");
    console.log("     - macOS AMD64: kanopy-oidc-macos-amd64-v0.5.3.tgz");
    console.log("     - Linux: kanopy-oidc-linux-amd64-v0.5.3.tgz");
  }
  console.log("  2. Extract and place in your PATH.");
}

async function setupHelmRepo() {
  chk(`Helm repo '${HELM_REPO_NAME}'...`);
  const repos = runCapture("helm repo list").stdout;
  if (repos.includes(HELM_REPO_NAME)) {
    ok(`Helm repo '${HELM_REPO_NAME}' already added.`);
  } else {
    action(`Adding Helm repo '${HELM_REPO_NAME}'...`);
    run(`helm repo add ${HELM_REPO_NAME} ${HELM_REPO_URL}`);
  }
  action("Updating Helm repos...");
  run("helm repo update");
  ok("Helm repos up to date.");
}

async function installKsecPlugin() {
  chk("Helm ksec plugin...");
  const plugins = runCapture("helm plugin list").stdout;
  if (plugins.includes("ksec")) { ok("ksec plugin installed."); return; }
  action("Installing ksec Helm plugin...");
  run("helm plugin install https://github.com/kanopy-platform/ksec");
}

async function createKanopyConfig() {
  chk(`Kanopy OIDC config at ${KANOPY_CONFIG_PATH}...`);
  if (existsSync(KANOPY_CONFIG_PATH)) {
    ok("Config already exists.");
    const overwrite = await ask("Overwrite? (y/N): ");
    if (overwrite.toLowerCase() !== "y") return;
  }

  const secret = process.env.KANOPY_CLUSTER_SECRET || "";
  if (!secret) {
    fail("KANOPY_CLUSTER_SECRET is not set. Add it to your .env file.");
    return;
  }

  const content = `domain: corp.mongodb.com
issuer: dex
login:
  connector: oidc
clusters:
  prod:
    secret: ${secret}
  staging:
    secret: ${secret}
`;

  const dir = resolve(KANOPY_CONFIG_PATH, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(KANOPY_CONFIG_PATH, content, "utf-8");
  ok(`Kanopy config created at ${KANOPY_CONFIG_PATH}`);
}

async function fullSetup() {
  console.log(`\n${CYAN}=== Full Kanopy Setup ===${NC}\n`);
  await installKubectl();
  await installHelm();
  await installKanopyOidc();
  await createKanopyConfig();
  await setupHelmRepo();
  await installKsecPlugin();
  console.log("");
  ok("Setup complete. Next: run 'Generate kubeconfig' from the menu.");
}

// ============================================================
//  2. CLUSTER CONFIG
// ============================================================

async function generateKubeconfig() {
  console.log("\nWhich cluster?");
  console.log("  1. staging (default)");
  console.log("  2. prod");
  console.log("  3. both");
  const input = await ask("Choice: ");
  const clusters = input === "2" ? ["prod"] : input === "3" ? ["staging", "prod"] : ["staging"];

  if (!existsSync(KUBE_DIR)) mkdirSync(KUBE_DIR, { recursive: true });

  for (const cluster of clusters) {
    console.log("");
    action(`Generating kubeconfig for '${cluster}'...`);
    const configFile = join(KUBE_DIR, `config.${cluster}`);
    const envPrefix = IS_WIN ? "set" : "export";

    const setupCmd = `kanopy-oidc kube setup ${cluster}`;
    console.log(`${DIM}[cmd]    ${setupCmd} > ${configFile}${NC}`);
    try {
      const output = execSync(setupCmd, { encoding: "utf-8", env: { ...process.env, KUBECONFIG: configFile } });
      writeFileSync(configFile, output, "utf-8");
    } catch (e: any) {
      fail(`Failed to setup kubeconfig for ${cluster}: ${e.message}`);
      continue;
    }

    const loginEnv = { ...process.env, KUBECONFIG: configFile };
    console.log(`${DIM}[cmd]    kanopy-oidc kube login${NC}`);
    const loginResult = spawnSync("kanopy-oidc", ["kube", "login"], { shell: true, stdio: "inherit", env: loginEnv });
    if (loginResult.status !== 0) {
      warn(`Login failed for ${cluster}. You can retry with option 7 later.`);
    }

    console.log(`${DIM}[cmd]    kubectl config set-context ... --namespace=${IST_NAMESPACE}${NC}`);
    spawnSync("kubectl", ["config", "set-context", "--current", `--namespace=${IST_NAMESPACE}`], {
      shell: true, stdio: "inherit", env: loginEnv,
    });

    ok(`Kubeconfig for '${cluster}' saved at ${configFile}`);
  }

  console.log("\nTo combine configs, set in your shell profile:");
  const sep = IS_WIN ? ";" : ":";
  const prefix = IS_WIN ? "set" : "export";
  console.log(`  ${prefix} KUBECONFIG=${join(KUBE_DIR, "config.staging")}${sep}${join(KUBE_DIR, "config.prod")}`);
}

async function kanopyLogin() {
  console.log("\n  1. staging\n  2. prod\n  3. both");
  const input = await ask("Which cluster to login? ");
  const clusters = input === "2" ? ["prod"] : input === "3" ? ["staging", "prod"] : ["staging"];

  for (const cluster of clusters) {
    const cfg = join(KUBE_DIR, `config.${cluster}`);
    if (!existsSync(cfg)) { fail(`Kubeconfig not found: ${cfg}. Run option 6 first.`); continue; }
    action(`Logging in with config: ${cfg}`);
    const result = spawnSync("kanopy-oidc", ["kube", "login"], {
      shell: true, stdio: "inherit", env: { ...process.env, KUBECONFIG: cfg },
    });
    result.status === 0 ? ok(`Login successful for ${cluster}`) : fail(`Login failed for ${cluster}`);
  }
}

async function switchContext() {
  console.log("\n  1. staging\n  2. prod");
  const input = await ask("Context: ");
  const target = input === "2" ? PROD_API : STAGING_API;
  const kubeconfig = `${join(KUBE_DIR, "config.staging")}${IS_WIN ? ";" : ":"}${join(KUBE_DIR, "config.prod")}`;
  const env = { ...process.env, KUBECONFIG: kubeconfig };
  spawnSync("kubectl", ["config", "use-context", target], { shell: true, stdio: "inherit", env });
  spawnSync("kubectl", ["config", "set-context", "--current", `--namespace=${IST_NAMESPACE}`], { shell: true, stdio: "inherit", env });
  ok(`Switched to ${target} / ${IST_NAMESPACE}`);
}

async function verifyAccess() {
  action("Verifying cluster access...");
  const kubeconfig = `${join(KUBE_DIR, "config.staging")}${IS_WIN ? ";" : ":"}${join(KUBE_DIR, "config.prod")}`;
  const env = { ...process.env, KUBECONFIG: kubeconfig };
  const result = spawnSync("kubectl", ["get", "pods", "-n", IST_NAMESPACE], { shell: true, stdio: "inherit", env });
  result.status === 0 ? ok("Access verified.") : fail("Access failed. Try: kanopy-oidc kube login");
}

// ============================================================
//  3. SECRETS
// ============================================================

function kubeEnv(): NodeJS.ProcessEnv {
  return { ...process.env, KUBECONFIG: `${join(KUBE_DIR, "config.staging")}${IS_WIN ? ";" : ":"}${join(KUBE_DIR, "config.prod")}` };
}

const KSEC_KEYS = ["MONGODB_URI", "MONGODB_DB_NAME", "KMS_LOCAL_MASTER_KEY", "KMS_KEY_VAULT_DATABASE", "KMS_KEY_VAULT_COLLECTION", "PSP_ADM_USER", "PSP_ADM_PASS"];

async function createSecrets() {
  console.log("\nCreate ksec secrets for which environment?");
  console.log("  1. staging (default)\n  2. production");
  const input = await ask("Choice: ");
  const isProd = input === "2";
  const secretName = isProd ? KSEC_SECRET_PROD : KSEC_SECRET_STAGING;
  const apiServer = isProd ? PROD_API : STAGING_API;

  action(`Switching context to ${apiServer}...`);
  const env = kubeEnv();
  spawnSync("kubectl", ["config", "use-context", apiServer], { shell: true, stdio: "pipe", env });
  spawnSync("kubectl", ["config", "set-context", "--current", `--namespace=${IST_NAMESPACE}`], { shell: true, stdio: "pipe", env });

  console.log("\nLoad values from:");
  console.log("  1. .env file (default)");
  console.log("  2. Enter manually");
  const source = await ask("Choice: ");

  const fields: [string, string][] = [];

  if (source === "2") {
    console.log(`\nEnter values for secret '${secretName}':`);
    console.log("(Press Enter to skip a field)\n");
    for (const key of KSEC_KEYS) {
      const val = await ask(`  ${key}: `);
      if (val) fields.push([key, val]);
    }
  } else {
    console.log(`\nLoading from ${ENV_PATH}...\n`);
    for (const key of KSEC_KEYS) {
      const val = process.env[key] || "";
      if (val) {
        fields.push([key, val]);
        const display = key.includes("KEY") || key.includes("PASS") || key.includes("URI")
          ? val.substring(0, 8) + "..."
          : val;
        console.log(`  ${GREEN}+${NC} ${key} = ${display}`);
      } else {
        console.log(`  ${DIM}-${NC} ${key} (not set, skipping)`);
      }
    }
  }

  if (fields.length === 0) { warn("No values to set. Skipping."); return; }

  console.log(`\n  ${fields.length} fields will be set on '${secretName}'`);
  const confirm = await ask("  Proceed? (Y/n): ");
  if (confirm.toLowerCase() === "n") { warn("Cancelled."); return; }

  const args = fields.map(([k, v]) => `${k}="${v}"`).join(" ");
  const cmd = `helm ksec set ${secretName} ${args}`;
  console.log(`${DIM}[cmd]    ${cmd}${NC}`);
  const result = spawnSync(cmd, { shell: true, stdio: "inherit", env });
  result.status === 0 ? ok(`Secret '${secretName}' created/updated.`) : fail("Failed to create secret.");
}

async function listSecrets() {
  action("Listing ksec secrets in current context...");
  spawnSync("helm", ["ksec", "list"], { shell: true, stdio: "inherit", env: kubeEnv() });
}

async function getSecret() {
  console.log(`\n  Known secrets:`);
  console.log(`    - ${KSEC_SECRET_STAGING} (staging)`);
  console.log(`    - ${KSEC_SECRET_PROD} (production)\n`);
  const name = (await ask(`Secret name (default: ${KSEC_SECRET_STAGING}): `)) || KSEC_SECRET_STAGING;
  spawnSync("helm", ["ksec", "get", name], { shell: true, stdio: "inherit", env: kubeEnv() });
}

// ============================================================
//  4. DEPLOYMENT
// ============================================================

async function getPods() {
  spawnSync("kubectl", ["get", "pods", "-n", IST_NAMESPACE, "-l", `app.kubernetes.io/instance in (${RELEASE_BACKEND},${RELEASE_FRONTEND})`], { shell: true, stdio: "inherit", env: kubeEnv() });
}

async function getAll() {
  const env = kubeEnv();
  console.log("--- Pods ---");
  spawnSync("kubectl", ["get", "pods", "-n", IST_NAMESPACE, "-l", `app.kubernetes.io/instance in (${RELEASE_BACKEND},${RELEASE_FRONTEND})`], { shell: true, stdio: "inherit", env });
  console.log("\n--- Deployments ---");
  spawnSync("kubectl", ["get", "deployments", "-n", IST_NAMESPACE], { shell: true, stdio: "inherit", env });
  console.log("\n--- Services ---");
  spawnSync("kubectl", ["get", "services", "-n", IST_NAMESPACE], { shell: true, stdio: "inherit", env });
  console.log("\n--- Ingress ---");
  spawnSync("kubectl", ["get", "ingress", "-n", IST_NAMESPACE], { shell: true, stdio: "inherit", env });
}

async function podLogs() {
  console.log("\n  1. backend\n  2. frontend");
  const input = await ask("Which service? ");
  const release = input === "2" ? RELEASE_FRONTEND : RELEASE_BACKEND;
  const tail = (await ask("Lines to show (default: 50): ")) || "50";
  spawnSync("kubectl", ["logs", "-l", `app.kubernetes.io/instance=${release}`, "-n", IST_NAMESPACE, `--tail=${tail}`], { shell: true, stdio: "inherit", env: kubeEnv() });
}

async function helmStatus() {
  const env = kubeEnv();
  console.log("--- Backend ---");
  spawnSync("helm", ["status", RELEASE_BACKEND, "-n", IST_NAMESPACE], { shell: true, stdio: "inherit", env });
  console.log("\n--- Frontend ---");
  spawnSync("helm", ["status", RELEASE_FRONTEND, "-n", IST_NAMESPACE], { shell: true, stdio: "inherit", env });
}

async function rolloutRestart() {
  console.log("\n  1. backend\n  2. frontend\n  3. both");
  const input = await ask("Restart which? ");
  const env = kubeEnv();
  if (input === "1" || input === "3") {
    run(`kubectl rollout restart deployment ${RELEASE_BACKEND}-web-app -n ${IST_NAMESPACE}`);
  }
  if (input === "2" || input === "3") {
    run(`kubectl rollout restart deployment ${RELEASE_FRONTEND}-web-app -n ${IST_NAMESPACE}`);
  }
  ok("Rollout restart initiated.");
}

async function resourceUsage() {
  spawnSync("kubectl", ["top", "pods", "-n", IST_NAMESPACE, "--containers"], { shell: true, stdio: "inherit", env: kubeEnv() });
}

// ============================================================
//  5. DRONE CI
// ============================================================

async function extractDroneSecrets() {
  console.log(`\n${CYAN}=== Extracting Drone secrets ===${NC}\n`);
  const env = kubeEnv();

  action("Switching to staging context...");
  spawnSync("kubectl", ["config", "use-context", STAGING_API], { shell: true, stdio: "pipe", env });
  spawnSync("kubectl", ["config", "set-context", "--current", `--namespace=${IST_NAMESPACE}`], { shell: true, stdio: "pipe", env });

  console.log("\n--- staging_kubernetes_token ---");
  const stagingToken = runCapture(`kubectl get secret kanopy-cicd-token -o jsonpath="{.data.token}" --kubeconfig="${join(KUBE_DIR, "config.staging")}"`);
  if (stagingToken.stdout) {
    const decoded = Buffer.from(stagingToken.stdout.replace(/"/g, ""), "base64").toString("utf-8");
    console.log(`  Value: ${DIM}${decoded.substring(0, 20)}...${NC}`);
  } else { warn("Could not extract staging token."); }

  console.log("\n--- ecr_access_key ---");
  const ecrAccess = runCapture(`kubectl get secret ecr -o jsonpath="{.data.ecr_access_key}" --kubeconfig="${join(KUBE_DIR, "config.staging")}"`);
  if (ecrAccess.stdout) {
    console.log(`  Value: ${Buffer.from(ecrAccess.stdout.replace(/"/g, ""), "base64").toString("utf-8")}`);
  } else { warn("Could not extract ECR access key."); }

  console.log("\n--- ecr_secret_key ---");
  const ecrSecret = runCapture(`kubectl get secret ecr -o jsonpath="{.data.ecr_secret_key}" --kubeconfig="${join(KUBE_DIR, "config.staging")}"`);
  if (ecrSecret.stdout) {
    const decoded = Buffer.from(ecrSecret.stdout.replace(/"/g, ""), "base64").toString("utf-8");
    console.log(`  Value: ${DIM}${decoded.substring(0, 10)}...${NC}`);
  } else { warn("Could not extract ECR secret key."); }

  action("Switching to prod context...");
  console.log("\n--- prod_kubernetes_token ---");
  const prodToken = runCapture(`kubectl get secret kanopy-cicd-token -o jsonpath="{.data.token}" --kubeconfig="${join(KUBE_DIR, "config.prod")}"`);
  if (prodToken.stdout) {
    const decoded = Buffer.from(prodToken.stdout.replace(/"/g, ""), "base64").toString("utf-8");
    console.log(`  Value: ${DIM}${decoded.substring(0, 20)}...${NC}`);
  } else { warn("Could not extract prod token."); }

  console.log(`\n${CYAN}Add these 4 secrets in Drone UI:${NC}`);
  console.log(`  ${DRONE_URL} -> Repo Settings -> Secrets`);
  console.log("  - staging_kubernetes_token");
  console.log("  - prod_kubernetes_token");
  console.log("  - ecr_access_key");
  console.log("  - ecr_secret_key");
}

async function showDroneInfo() {
  console.log(`\n${CYAN}=== Drone CI Info ===${NC}\n`);
  console.log(`  Drone URL: ${DRONE_URL}`);
  console.log("\n  Pipeline triggers:");
  console.log("    staging    -> push to 'staging' branch");
  console.log("    production -> push to 'main' branch");
  console.log("\n  Required Drone secrets:");
  console.log("    - staging_kubernetes_token");
  console.log("    - prod_kubernetes_token");
  console.log("    - ecr_access_key");
  console.log("    - ecr_secret_key");
  console.log(`\n  ECR repositories:`);
  console.log(`    - ${ECR_REGISTRY}/${IST_NAMESPACE}/${DEMO_NAME}-backend`);
  console.log(`    - ${ECR_REGISTRY}/${IST_NAMESPACE}/${DEMO_NAME}-frontend`);
  console.log(`\n  Staging URLs:`);
  console.log(`    Backend:  https://${STAGING_HOST_BE}`);
  console.log(`    Frontend: https://${STAGING_HOST_FE}`);
  console.log(`\n  Production URLs:`);
  console.log(`    Backend:  https://${PROD_HOST_BE}`);
  console.log(`    Frontend: https://${PROD_HOST_FE}`);
}

// ============================================================
//  6. DIAGNOSTICS
// ============================================================

async function describePod() {
  const env = kubeEnv();
  let podName = await ask("Pod name (Enter to list): ");
  if (!podName) {
    spawnSync("kubectl", ["get", "pods", "-n", IST_NAMESPACE, "-o", "name"], { shell: true, stdio: "inherit", env });
    podName = await ask("\nPod name: ");
  }
  if (podName) spawnSync("kubectl", ["describe", "pod", podName, "-n", IST_NAMESPACE], { shell: true, stdio: "inherit", env });
}

async function execIntoPod() {
  console.log("\n  1. backend\n  2. frontend");
  const input = await ask("Which service? ");
  const release = input === "2" ? RELEASE_FRONTEND : RELEASE_BACKEND;
  const deployment = `${release}-web-app`;
  console.log(`${DIM}[cmd]    kubectl exec -it deployment/${deployment} -n ${IST_NAMESPACE} -- sh${NC}`);
  spawnSync("kubectl", ["exec", "-it", `deployment/${deployment}`, "-n", IST_NAMESPACE, "--", "sh"], { shell: true, stdio: "inherit", env: kubeEnv() });
}

async function checkEnvVars() {
  console.log("\n  1. backend\n  2. frontend");
  const input = await ask("Which service? ");
  const release = input === "2" ? RELEASE_FRONTEND : RELEASE_BACKEND;
  const deployment = `${release}-web-app`;
  spawnSync("kubectl", ["exec", `deployment/${deployment}`, "-n", IST_NAMESPACE, "--", "env"], { shell: true, stdio: "inherit", env: kubeEnv() });
}

async function testUrls() {
  const env = kubeEnv();
  const ctx = spawnSync("kubectl", ["config", "current-context"], { shell: true, encoding: "utf-8", env }).stdout.trim();
  const isStaging = ctx.includes("staging");
  const bUrl = `https://${isStaging ? STAGING_HOST_BE : PROD_HOST_BE}/health`;
  const fUrl = `https://${isStaging ? STAGING_HOST_FE : PROD_HOST_FE}`;

  console.log(`  Testing backend health: ${bUrl}`);
  try {
    const resp = await fetch(bUrl, { signal: AbortSignal.timeout(10000) });
    resp.ok ? ok(`Backend: ${resp.status}`) : warn(`Backend: HTTP ${resp.status}`);
  } catch (e: any) { warn(`Backend unreachable: ${e.message}`); }

  console.log(`  Testing frontend: ${fUrl}`);
  try {
    const resp = await fetch(fUrl, { signal: AbortSignal.timeout(10000) });
    resp.ok ? ok(`Frontend: ${resp.status}`) : warn(`Frontend: HTTP ${resp.status}`);
  } catch (e: any) { warn(`Frontend unreachable: ${e.message}`); }
}

// ============================================================
//  7. PRE-DEPLOYMENT CHECKLIST
// ============================================================

async function preDeployChecklist() {
  console.log(`\n${CYAN}=== Pre-Deployment Checklist ===${NC}\n`);
  let passed = 0, failed = 0;

  function check(label: string, condition: boolean) {
    if (condition) { console.log(`  ${GREEN}[PASS]${NC} ${label}`); passed++; }
    else { console.log(`  ${RED}[FAIL]${NC} ${label}`); failed++; }
  }

  check("kubectl installed", hasCommand("kubectl"));
  check("helm installed", hasCommand("helm"));
  check("kanopy-oidc installed", hasCommand("kanopy-oidc"));
  check("ksec plugin installed", runCapture("helm plugin list").stdout.includes("ksec"));
  check("Kanopy config exists", existsSync(KANOPY_CONFIG_PATH));
  check("Staging kubeconfig exists", existsSync(join(KUBE_DIR, "config.staging")));
  check("Production kubeconfig exists", existsSync(join(KUBE_DIR, "config.prod")));
  check(".drone.yml exists", existsSync(join(PROJECT_ROOT, ".drone.yml")));
  check("environments/staging.yaml", existsSync(join(PROJECT_ROOT, "environments", "staging.yaml")));
  check("environments/production.yaml", existsSync(join(PROJECT_ROOT, "environments", "production.yaml")));
  check("backend/Dockerfile exists", existsSync(join(PROJECT_ROOT, "backend", "Dockerfile")));
  check("frontend/Dockerfile exists", existsSync(join(PROJECT_ROOT, "frontend", "Dockerfile")));

  const color = failed === 0 ? GREEN : YELLOW;
  console.log(`\n  ${color}Result: ${passed} passed, ${failed} failed${NC}`);
}

// ============================================================
//  MAIN MENU
// ============================================================

const MENU = `
============================================
 Menu
============================================
  --- Setup ---
  1.  Full setup (install all prerequisites)
  2.  Install kubectl only
  3.  Install Helm + MongoDB repo + ksec
  4.  Install/check kanopy-oidc
  5.  Create kanopy OIDC config file
  --- Cluster ---
  6.  Generate kubeconfig (staging/prod/both)
  7.  Login (re-authenticate token)
  8.  Switch context (staging/prod)
  9.  Verify cluster access
  --- Secrets ---
  10. Create/update ksec secrets
  11. List ksec secrets
  12. Get ksec secret values
  --- Deployment ---
  13. Get pods (this demo)
  14. Get all resources (pods/deploy/svc/ingress)
  15. View pod logs
  16. Helm release status
  17. Rollout restart
  18. Resource usage (top)
  --- Drone CI ---
  19. Extract Drone secrets from cluster
  20. Show Drone/deployment info
  --- Diagnostics ---
  21. Describe pod
  22. Exec into pod (shell)
  23. Check env vars in pod
  24. Test staging/prod URLs
  25. Pre-deployment checklist
  --- ---
  0.  Exit
`;

async function main() {
  console.log(`\n${CYAN}============================================${NC}`);
  console.log(`${CYAN} Kanopy Deployment Manager${NC}`);
  console.log(`${DIM} ${DEMO_NAME}${NC}`);
  console.log(`${CYAN}============================================${NC}`);

  while (true) {
    console.log(MENU);
    const choice = await ask("Select an option: ");

    switch (choice) {
      case "1": await fullSetup(); break;
      case "2": await installKubectl(); break;
      case "3": await installHelm(); await setupHelmRepo(); await installKsecPlugin(); break;
      case "4": await installKanopyOidc(); break;
      case "5": await createKanopyConfig(); break;
      case "6": await generateKubeconfig(); break;
      case "7": await kanopyLogin(); break;
      case "8": await switchContext(); break;
      case "9": await verifyAccess(); break;
      case "10": await createSecrets(); break;
      case "11": await listSecrets(); break;
      case "12": await getSecret(); break;
      case "13": await getPods(); break;
      case "14": await getAll(); break;
      case "15": await podLogs(); break;
      case "16": await helmStatus(); break;
      case "17": await rolloutRestart(); break;
      case "18": await resourceUsage(); break;
      case "19": await extractDroneSecrets(); break;
      case "20": await showDroneInfo(); break;
      case "21": await describePod(); break;
      case "22": await execIntoPod(); break;
      case "23": await checkEnvVars(); break;
      case "24": await testUrls(); break;
      case "25": await preDeployChecklist(); break;
      case "0": console.log("\nGoodbye."); rl.close(); process.exit(0);
      default: warn("Invalid option. Enter 1-25 or 0.");
    }

    if (choice !== "0") await pause();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
