const PANEL_ID = "topwar-unified-control-panel-v26";
const INSTALL_FLAG = "__TOPWAR_ALLINONE_UI_V1__";
const TAB_KEY = "TOPWAR_ALLINONE_ACTIVE_TAB";

const MODULES = [
  { id: "characterTools", label: "캐릭터 판매·영웅 조사", panelIds: ["topwar-nav-v093"] },
  { id: "crossPvp", label: "Cross PVP TOP100", panelIds: ["cross100-standalone-panel"] },
  { id: "train", label: "CQ26 설원 열차", panelIds: ["CQ26_AUTO_V6_PANEL"] },
  { id: "kartz", label: "Kartz 랭킹", panelIds: ["kartz-collector-panel"] },
  { id: "htChip", label: "HT Chip", panelIds: ["htc-root"] },
  { id: "heroImages", label: "영웅 이미지 추출", oneShot: true },
  {
    id: "energyDefense",
    label: "SSC2 에너지 방어",
    oneShot: true,
    promiseKey: "CQ26_ENERGY_DEFENSE_PROMISE"
  },
  {
    id: "mammothDefense",
    label: "SSC2 맘모스 방어",
    oneShot: true,
    embedded: true,
    help: "게임에서 맘모스 방어 수위병 랭킹 화면과 원하는 하위 탭을 연 뒤 조사하세요.",
    actionLabel: "랭킹 조사",
    progressText: "수위병 랭킹 데이터를 찾는 중…",
    promiseKey: "CQ26_MAMMOTH_DEFENSE_PROMISE"
  },
  {
    id: "trainMembers",
    label: "SSC2 열차 멤버",
    oneShot: true,
    embedded: true,
    promiseKey: "CQ26_TRAIN_MEMBERS_PROMISE"
  },
  {
    id: "sealRanks",
    label: "SSC2 봉인석 랭킹",
    oneShot: true,
    embedded: true,
    help: "게임에서 봉인석 총 랭킹 또는 라운드 랭킹 탭을 연 뒤 읽으세요.",
    actionLabel: "현재 랭킹 읽기",
    promiseKey: "CQ26_SEAL_RANK_PROMISE"
  },
  { id: "guildAudit", label: "길드 공헌도", oneShot: true }
];

function addStyles() {
  if (document.getElementById("topwar-allinone-ui-style")) return;
  const style = document.createElement("style");
  style.id = "topwar-allinone-ui-style";
  style.textContent = `
    #${PANEL_ID} { width:min(350px,calc(100vw - 42px)) !important;max-height:calc(100vh - 12px) !important; }
    #${PANEL_ID}, #${PANEL_ID} * { box-sizing:border-box; }
    #${PANEL_ID} #tw26-header { height:34px !important;padding:0 8px !important;font-size:12px !important; }
    #${PANEL_ID} #tw26-body { padding:6px !important;max-height:calc(100vh - 46px) !important; }
    #tw-all-tabs { position:sticky;top:0;z-index:5;display:grid;grid-template-columns:repeat(3,1fr);gap:3px;margin-bottom:5px;background:rgba(24,24,24,.98); }
    #tw-all-tabs button { height:27px;border:0;border-radius:5px;background:#333;color:#aaa;font-size:10px;cursor:pointer; }
    #tw-all-tabs button[data-active="true"] { background:#2563eb;color:#fff;font-weight:700; }
    .tw-all-page[hidden] { display:none !important; }
    #${PANEL_ID} #tw26-status { height:29px;max-height:29px;overflow:hidden;margin-bottom:5px !important;padding:5px 7px !important;font-size:10px !important;line-height:17px !important; }
    #${PANEL_ID} #tw26-status > div:first-child { height:17px;min-width:0; }
    #${PANEL_ID} #tw26-status > div:first-child > span:first-child { min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    #${PANEL_ID} #tw26-status > div:nth-child(n+2) { display:none !important; }
    #${PANEL_ID} #tw26-server { height:30px !important;font-size:12px !important; }
    #${PANEL_ID} #tw26-server-order { display:grid !important;grid-template-columns:repeat(3,minmax(0,1fr));gap:3px !important;margin-top:4px !important;padding:3px !important;background:rgba(255,255,255,.035) !important; }
    #${PANEL_ID} #tw26-server-order label { height:26px;justify-content:center;gap:3px !important;border:1px solid transparent;border-radius:5px;background:rgba(255,255,255,.045);font-size:10px !important;white-space:nowrap; }
    #${PANEL_ID} #tw26-server-order label:has(input:checked) { border-color:#4d8dff;background:#245fbe;color:#fff;font-weight:700; }
    #${PANEL_ID} #tw26-server-order input { width:11px;height:11px;margin:0;accent-color:#fff; }
    #${PANEL_ID} #tw26-scan-actions { gap:4px !important;margin-top:5px !important; }
    #${PANEL_ID} #tw26-scan-actions button { height:31px !important;font-size:11px !important; }
    #${PANEL_ID} #tw26-top100-actions { grid-template-columns:repeat(2,minmax(0,1fr)) !important;gap:4px !important;margin-top:4px !important; }
    #${PANEL_ID} #tw26-realpower { grid-column:1 / -1;height:31px !important; }
    #${PANEL_ID} #tw26-realpower-status { grid-column:1 / -1;max-height:34px;overflow:auto;font-size:9px !important;padding:4px !important; }
    #${PANEL_ID} #tw26-realpower-reset,
    #${PANEL_ID} #tw26-realpower-upload,
    #${PANEL_ID} #tw26-realpower-recovery-stop { min-height:27px !important;height:auto !important;font-size:9px !important;padding:4px !important; }
    .tw-all-settings-group { margin-bottom:6px;padding:6px;border:1px solid rgba(255,255,255,.08);border-radius:6px;background:rgba(255,255,255,.035); }
    .tw-all-settings-group > strong { display:block;margin-bottom:5px;color:#aaa;font-size:10px; }
    .tw-all-settings-actions { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px; }
    .tw-all-settings-actions > button { min-height:29px;border:0;border-radius:6px;background:#333;color:#ddd;font-size:10px; }
    #tw-all-tools { display:grid;gap:6px; }
    .tw-all-tool-picker { display:grid;grid-template-columns:minmax(0,1fr) 70px;gap:5px; }
    .tw-all-tool-picker select,.tw-all-tool-picker button { height:31px;border:1px solid rgba(255,255,255,.12);border-radius:6px;background:#292929;color:#eee;font-size:10px;padding:0 6px; }
    .tw-all-tool-status { color:#888;font-size:10px;margin-top:4px; }
    .tw-all-tool-host { margin-top:7px; }
    .tw-all-tool-host > * { position:static !important;inset:auto !important;width:100% !important;max-width:none !important;max-height:none !important;transform:none !important;box-shadow:none !important;margin:0 !important; }
    .tw-all-embedded-tool { padding:7px;border:1px solid rgba(255,255,255,.1);border-radius:6px;background:rgba(255,255,255,.035); }
    .tw-all-embedded-tool > strong { display:block;margin-bottom:4px;color:#eee;font-size:11px; }
    .tw-all-embedded-tool > p { margin:0 0 6px;color:#999;font-size:10px;line-height:1.45; }
    .tw-all-embedded-tool > button { width:100%;height:31px;border:0;border-radius:6px;background:#2563eb;color:#fff;font-size:11px;font-weight:700;cursor:pointer; }
    .tw-all-embedded-tool > button:disabled { opacity:.55;cursor:wait; }
    .tw-all-embedded-result { min-height:17px;margin-top:5px;color:#aaa;font-size:10px;line-height:17px;white-space:pre-wrap; }
    @media (max-width:500px), (max-height:500px) {
      #${PANEL_ID} { top:6px !important;right:6px !important;width:min(350px,calc(100vw - 42px)) !important; }
      #${PANEL_ID} #tw26-memory-gauge { display:none !important; }
      #${PANEL_ID} #tw26-header > span:first-child { font-size:11px !important; }
      #${PANEL_ID} #tw26-fold { font-size:9px !important; }
    }
  `;
  document.head.append(style);
}

function setTab(name) {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return;
  panel.querySelectorAll(".tw-all-page").forEach(page => { page.hidden = page.dataset.page !== name; });
  panel.querySelectorAll("#tw-all-tabs button").forEach(button => {
    button.dataset.active = String(button.dataset.tab === name);
  });
  localStorage.setItem(TAB_KEY, name);
}

function mountExistingPanel(module, host) {
  for (const id of module.panelIds || []) {
    const child = document.getElementById(id);
    if (child && child.parentElement !== host) host.append(child);
  }
}

function runModule(module, host, status) {
  if (module.embedded) {
    const card = document.createElement("section");
    card.className = "tw-all-embedded-tool";
    const title = document.createElement("strong");
    title.textContent = module.label;
    const help = document.createElement("p");
    help.textContent = module.help || "게임에서 설원 열차 부대 정보 창을 연 뒤 조사하세요.";
    const action = document.createElement("button");
    action.type = "button";
    action.textContent = module.actionLabel || "멤버 조사";
    const result = document.createElement("div");
    result.className = "tw-all-embedded-result";
    result.textContent = "대기 중";
    action.addEventListener("click", async () => {
      action.disabled = true;
      action.textContent = "조사 중…";
      result.textContent = module.progressText || "참여자 데이터를 찾는 중…";
      runModule({ ...module, embedded: false }, host, result);
      const pending = module.promiseKey ? window[module.promiseKey] : null;
      try {
        if (pending && typeof pending.then === "function") await pending;
      } catch {
        // runModule에서 같은 오류를 상태 영역과 콘솔에 표시한다.
      } finally {
        action.disabled = false;
      action.textContent = module.retryLabel || "다시 실행";
      }
    });
    card.append(title, help, action, result);
    host.replaceChildren(card);
    status.textContent = "기존 창에 열차 멤버 도구 연결 완료";
    return;
  }

  const installer = window.__TOPWAR_ALLINONE_INSTALLERS__?.[module.id];
  if (typeof installer !== "function") {
    status.textContent = "원본 모듈을 찾지 못했습니다.";
    return;
  }
  try {
    const previousNavigation = module.id === "characterTools" ? window.TOPWAR_NAV : null;
    const result = installer();
    // 캐릭터 도구 원본은 자체 Navigation API를 설치한다. 도구 UI는 클로저의 API를
    // 계속 사용하므로 메인 조사기의 TOPWAR_NAV만 원상복구해 두 런타임 충돌을 막는다.
    if (module.id === "characterTools" && previousNavigation) {
      window.TOPWAR_CHARACTER_NAV = window.TOPWAR_NAV;
      window.TOPWAR_NAV = previousNavigation;
    }
    const pending = module.promiseKey ? window[module.promiseKey] : result;
    if (pending && typeof pending.then === "function") {
      status.textContent = "조사 중…";
      Promise.resolve(pending).then(output => {
        const count = Number(output?.count || 0);
        status.textContent = count
          ? `${count.toLocaleString()}명 조사·복사 완료`
          : "원본 기능 실행 완료";
      }).catch(error => {
        status.textContent = `실행 실패: ${error?.message || error}`;
        console.error(`[TopWar All-in-One] ${module.id} async installer failed`, error);
      });
    } else {
      status.textContent = module.oneShot ? "원본 기능 실행 완료" : "원본 UI 연결 완료";
    }
    if (!module.oneShot) {
      setTimeout(() => mountExistingPanel(module, host), 0);
      setTimeout(() => mountExistingPanel(module, host), 500);
    }
  } catch (error) {
    status.textContent = `실행 실패: ${error?.message || error}`;
    console.error(`[TopWar All-in-One] ${module.id} installer failed`, error);
  }
}

function createToolsPage() {
  const page = document.createElement("section");
  page.className = "tw-all-page";
  page.dataset.page = "tools";
  page.id = "tw-all-tools";
  const picker = document.createElement("div");
  picker.className = "tw-all-tool-picker";
  const select = document.createElement("select");
  for (const module of MODULES) {
    const option = document.createElement("option");
    option.value = module.id;
    option.textContent = module.label;
    select.append(option);
  }
  const button = document.createElement("button");
  button.textContent = "열기";
  const status = document.createElement("div");
  status.className = "tw-all-tool-status";
  status.textContent = "도구를 선택하세요.";
  const host = document.createElement("div");
  host.className = "tw-all-tool-host";
  button.addEventListener("click", () => {
    const module = MODULES.find(row => row.id === select.value);
    if (!module) return;
    host.replaceChildren();
    runModule(module, host, status);
  });
  picker.append(select, button);
  page.append(picker, status, host);
  return page;
}

function settingsGroup(title, nodes, actions = false) {
  const group = document.createElement("div");
  group.className = "tw-all-settings-group";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const content = document.createElement("div");
  if (actions) content.className = "tw-all-settings-actions";
  for (const node of nodes.filter(Boolean)) content.append(node);
  group.append(heading, content);
  return group;
}

function integrate(panel) {
  if (!panel || panel.dataset.allInOneUi === "true") return false;
  const body = panel.querySelector("#tw26-body");
  const headerTitle = panel.querySelector("#tw26-header > span:first-child");
  if (!body) return false;
  panel.dataset.allInOneUi = "true";
  if (headerTitle) headerTitle.textContent = "TW All-in-One";
  addStyles();

  const originalChildren = [...body.children];
  const tabs = document.createElement("nav");
  tabs.id = "tw-all-tabs";
  for (const [name, label] of [["survey", "조사"], ["tools", "도구"], ["settings", "설정"]]) {
    const button = document.createElement("button");
    button.dataset.tab = name;
    button.textContent = label;
    button.addEventListener("click", () => setTab(name));
    tabs.append(button);
  }

  const survey = document.createElement("section");
  survey.className = "tw-all-page";
  survey.dataset.page = "survey";
  const settings = document.createElement("section");
  settings.className = "tw-all-page";
  settings.dataset.page = "settings";
  const tools = createToolsPage();

  for (const child of originalChildren) {
    if (!["tw26-advanced", "tw26-scanner-role", "tw26-reward-tracker-actions"].includes(child.id)) {
      survey.append(child);
    }
  }
  const serverOrder = originalChildren.find(node => node.id === "tw26-server-order");
  const scannerRole = originalChildren.find(node => node.id === "tw26-scanner-role");
  const serverOrderLabels = {
    sequential: "번호순",
    popular: "인기순",
    random: "랜덤"
  };
  serverOrder?.querySelectorAll('input[name="tw26-server-order"]').forEach(input => {
    const label = input.closest("label");
    const textNode = [...(label?.childNodes || [])].find(node => node.nodeType === Node.TEXT_NODE);
    if (textNode) textNode.nodeValue = serverOrderLabels[input.value] || input.value;
  });
  settings.append(settingsGroup("조사기 분배", [scannerRole]));

  const fullScan = document.getElementById("tw26-full-scan");
  const rewardTracker = originalChildren.find(node => node.id === "tw26-reward-tracker-actions");
  settings.append(settingsGroup("보조 작업", [fullScan, rewardTracker], true));

  const advanced = originalChildren.find(node => node.id === "tw26-advanced");
  if (advanced) {
    advanced.open = false;
    settings.append(advanced);
  }
  body.replaceChildren(tabs, survey, tools, settings);
  setTab(localStorage.getItem(TAB_KEY) || "survey");
  console.info("[TopWar All-in-One] existing components connected to unified UI");
  return true;
}

function boot() {
  if (window[INSTALL_FLAG]) return;
  window[INSTALL_FLAG] = true;
  const tryInstall = () => integrate(document.getElementById(PANEL_ID));
  tryInstall();
  const observer = new MutationObserver(() => tryInstall());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.TOPWAR_ALLINONE_UI = Object.freeze({
    version: "0.2.0",
    showTab: setTab,
    modules: () => MODULES.map(({ id, label, oneShot }) => ({ id, label, oneShot: !!oneShot })),
    reconnect: tryInstall
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
