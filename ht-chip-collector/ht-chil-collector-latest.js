(() => {
    "use strict";

    const page = window;
    const STORAGE_KEY = "ht_chip_collect_queue_v1";
    const UPLOAD_URL = "https://datahub.progamer.info/ht-chip-collect";

    page.__rewardDetector?.destroy?.();
    page.__htChipCollector?.destroy?.();
    document.querySelector("#reward-tool-root")?.remove();
    document.querySelector("#htc-root")?.remove();
    document.querySelector("#htc-style")?.remove();

    let enabled = false;
    let armed = false;
    let detailWasOpen = false;
    let latest = null;

    const findNode = (root, predicate) => {
        if (!root) return null;
        if (predicate(root)) return root;
        for (const child of root.children || []) {
            const found = findNode(child, predicate);
            if (found) return found;
        }
        return null;
    };

    const findAll = (root, predicate, output = []) => {
        if (!root) return output;
        if (predicate(root)) output.push(root);
        for (const child of root.children || []) findAll(child, predicate, output);
        return output;
    };

    const text = node => {
        if (!node) return "";
        const c = node.getComponent(page.cc.Label) || node.getComponent(page.cc.RichText);
        return String(c?.string || "").trim();
    };

    const activeNode = name => findNode(
        page.cc.director.getScene(),
        node => node.name === name && node.activeInHierarchy
    );

    const descendantText = (root, names) => text(findNode(
        root,
        node => names.includes(node.name) && text(node)
    ));

    const parseValue = value => {
        const raw = String(value || "").replace(/%/g, "").trim();
        const number = Number(raw);
        return Number.isFinite(number) ? number : raw;
    };

    const readAttributes = section => {
        if (!section) return [];
        return findAll(section, node => node.name === "buffdes" && text(node))
            .map(node => [
                text(node),
                parseValue(descendantText(node, ["num1", "num2", "num"]))
            ])
            .filter(([name, value]) => name && value !== "");
    };

    const readAllText = panel => {
        const output = [];
        const walk = (node, path = node.name) => {
            const label = node.getComponent(page.cc.Label);
            const rich = node.getComponent(page.cc.RichText);
            const value = String((label || rich)?.string || "").trim();
            if (value && node.activeInHierarchy) {
                output.push({ t: label ? "L" : "R", v: value, p: path });
            }
            for (const child of node.children || []) walk(child, `${path}/${child.name}`);
        };
        walk(panel);
        return output;
    };

    const extract = panel => {
        const quality = findNode(panel, node => node.name === "qualityLab" && text(node));
        const title = quality?.parent || findNode(panel, node => node.name === "titleNode");
        const name = findNode(title, node => node.name === "labName" && text(node));
        const base = findNode(panel, node => node.name === "basebuffNode");
        const random = findNode(panel, node => node.name === "buffNode");
        return {
            n: text(name),
            q: text(quality),
            b: readAttributes(base),
            r: readAttributes(random),
            all: readAllText(panel)
        };
    };

    const loadQueue = () => {
        try {
            const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
            const unique = new Map();
            for (const row of stored) {
                if (!Array.isArray(row) || row.length < 4) continue;
                const normalized = row.slice(0, 4);
                unique.set(JSON.stringify(normalized), normalized);
            }
            return [...unique.values()];
        }
        catch (_) { return []; }
    };

    const saveQueue = queue => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
        updateCount();
    };

    // Stored tuple: [name, grade, base attributes, random attributes]
    const compactItem = item => [item.n, item.q, item.b, item.r];
    const signature = tuple => JSON.stringify(tuple.slice(0, 4));

    const enqueue = item => {
        const queue = loadQueue();
        const tuple = compactItem(item);
        const key = signature(tuple);
        const existing = queue.find(row => signature(row) === key);
        if (existing) return false;
        queue.push(tuple);
        saveQueue(queue);
        return true;
    };

    const style = document.createElement("style");
    style.id = "htc-style";
    style.textContent = `
        #htc-root{position:fixed;right:10px;bottom:10px;z-index:2147483647;font:12px sans-serif;color:#eee}
        #htc-root button{padding:6px 9px;border:1px solid #656b73;border-radius:6px;background:#30343b;color:#fff;cursor:pointer}
        #htc-mini{display:flex;gap:4px;opacity:.9;filter:drop-shadow(0 2px 5px #000a)}
        #htc-summary,#htc-detail{display:none;padding:9px;border:1px solid #60656d;border-radius:8px;background:#16181df2;box-shadow:0 4px 18px #0009}
        #htc-summary{width:310px} #htc-detail{width:450px;max-width:calc(100vw - 20px);max-height:75vh}
        .htc-head,.htc-actions{display:flex;align-items:center;gap:5px}.htc-head{justify-content:space-between;margin-bottom:7px}
        #htc-summary-body{max-height:170px;overflow:auto;line-height:1.45}
        #htc-detail-body{max-height:calc(75vh - 55px);overflow:auto;word-break:break-all}
        .htc-base{color:#78e5a0}.htc-random{color:#e6a0ff}.htc-path{color:#828b96;font-size:10px;border-bottom:1px dotted #444;margin:2px 0 7px;padding-bottom:4px}
    `;
    document.head.append(style);

    const root = document.createElement("div");
    root.id = "htc-root";
    root.innerHTML = `
        <div id="htc-mini">
            <button id="htc-toggle">보상 감지 OFF</button>
            <button id="htc-open" style="display:none">보기</button>
            <button id="htc-upload">업로드 0</button>
        </div>
        <div id="htc-summary">
            <div class="htc-head"><b id="htc-title">감지된 아이템 없음</b><div class="htc-actions"><button id="htc-more">상세보기</button><button id="htc-hide">숨기기</button></div></div>
            <div id="htc-summary-body">보상 감지를 켜고 아이템을 누르세요.</div>
        </div>
        <div id="htc-detail">
            <div class="htc-actions" style="margin-bottom:8px"><button id="htc-back">요약으로</button><button id="htc-copy">JSON 복사</button><button id="htc-detail-hide">숨기기</button></div>
            <div id="htc-detail-body"></div>
        </div>`;
    document.body.append(root);

    const $ = selector => root.querySelector(selector);
    const mini = $("#htc-mini");
    const summary = $("#htc-summary");
    const detail = $("#htc-detail");
    const toggle = $("#htc-toggle");
    const open = $("#htc-open");
    const upload = $("#htc-upload");
    const title = $("#htc-title");
    const summaryBody = $("#htc-summary-body");
    const detailBody = $("#htc-detail-body");

    const show = target => {
        mini.style.display = target === mini ? "flex" : "none";
        summary.style.display = target === summary ? "block" : "none";
        detail.style.display = target === detail ? "block" : "none";
    };

    function updateCount() {
        const queue = loadQueue();
        upload.textContent = `업로드 ${queue.length}`;
    }

    const row = (parent, value, className = "") => {
        const element = document.createElement("div");
        element.className = className;
        element.textContent = value;
        parent.append(element);
    };

    const render = item => {
        title.textContent = `${item.n || "이름 없음"} · ${item.q || "등급 없음"}`;
        summaryBody.textContent = "";
        for (const [name, value] of item.b) row(summaryBody, `기본 · ${name} ${value}%`, "htc-base");
        for (const [name, value] of item.r) row(summaryBody, `랜덤 · ${name} ${value}%`, "htc-random");

        detailBody.textContent = "";
        row(detailBody, `${item.n} · ${item.q}`);
        for (const [name, value] of item.b) row(detailBody, `기본 · ${name}: ${value}%`, "htc-base");
        for (const [name, value] of item.r) row(detailBody, `랜덤 · ${name}: ${value}%`, "htc-random");
        row(detailBody, `전체 UI 텍스트 (${item.all.length}개)`);
        item.all.forEach((entry, index) => {
            row(detailBody, `${index + 1}. [${entry.t}] ${entry.v}`);
            row(detailBody, entry.p, "htc-path");
        });
    };

    const setEnabled = value => {
        enabled = value;
        armed = false;
        detailWasOpen = Boolean(page.cc && activeNode("MechaChipDetailPanel"));
        toggle.textContent = `보상 감지 ${enabled ? "ON" : "OFF"}`;
        toggle.style.background = enabled ? "#176f38" : "#30343b";
    };

    const doUpload = () => {
        const queue = loadQueue();
        if (!queue.length) return alert("업로드할 데이터가 없습니다.");
        upload.disabled = true;
        upload.textContent = "업로드 중…";
        const body = JSON.stringify({ d: queue });

        const done = responseText => {
            localStorage.removeItem(STORAGE_KEY);
            updateCount();
            upload.disabled = false;
            alert(`업로드 완료\n${responseText || ""}`);
        };
        const fail = status => {
            updateCount();
            upload.disabled = false;
            alert(`업로드 실패 (${status || "network"})`);
        };

        fetch(UPLOAD_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body
        })
            .then(async response => {
                const responseText = await response.text();
                if (response.ok) done(responseText);
                else fail(response.status);
            })
            .catch(() => fail("network"));
    };

    toggle.onclick = () => setEnabled(!enabled);
    open.onclick = () => latest && show(summary);
    upload.onclick = doUpload;
    $("#htc-hide").onclick = () => show(mini);
    $("#htc-detail-hide").onclick = () => show(mini);
    $("#htc-more").onclick = () => latest && show(detail);
    $("#htc-back").onclick = () => show(summary);
    $("#htc-copy").onclick = () => latest && navigator.clipboard.writeText(JSON.stringify(latest, null, 2));

    const timer = setInterval(() => {
        if (!enabled || !page.cc?.director) return;
        try {
            const reward = activeNode("rewardOutPanel");
            const detailPanel = activeNode("MechaChipDetailPanel");
            const detailOpen = Boolean(detailPanel);
            if (reward && !detailOpen) armed = true;
            if (armed && detailOpen && !detailWasOpen) {
                armed = false;
                setTimeout(() => {
                    const panel = activeNode("MechaChipDetailPanel");
                    if (!panel) return;
                    const item = extract(panel);
                    if (!item.n || !item.q) return console.warn("[HTC] extraction failed", item);
                    latest = item;
                    const added = enqueue(item);
                    render(item);
                    open.style.display = "inline-block";
                    show(summary);
                    console.log(added ? "[HTC] queued" : "[HTC] duplicate skipped", item, loadQueue());
                }, 250);
            }
            detailWasOpen = detailOpen;
        } catch (error) {
            console.error("[HTC] detector error", error);
        }
    }, 150);

    page.__htChipCollector = {
        queue: loadQueue,
        upload: doUpload,
        clear: () => { localStorage.removeItem(STORAGE_KEY); updateCount(); },
        destroy: () => {
            clearInterval(timer);
            root.remove();
            style.remove();
            delete page.__htChipCollector;
        }
    };

    setEnabled(false);
    updateCount();
    show(mini);
})();
