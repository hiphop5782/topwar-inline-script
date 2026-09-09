(() => {
    'use strict';

    const VERSION = '2026.09.09-all-in-one';

    // ============================================================
    // 공통
    // ============================================================

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function safeDestroy(node) {
        if (!node) return;

        try {
            if (node.isValid !== false) {
                node.destroy();
            }
        } catch {}
    }

    function sanitizeFilename(name) {
        return String(name || '')
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;

        document.body.appendChild(a);
        a.click();
        a.remove();

        setTimeout(() => {
            URL.revokeObjectURL(url);
        }, 1000);
    }

    function downloadText(text, filename, type = 'application/json') {
        const blob = new Blob(
            [text],
            {
                type: `${type};charset=utf-8`
            }
        );

        downloadBlob(blob, filename);
    }

    function canvasToBlob(canvas, type = 'image/png') {
        return new Promise((resolve, reject) => {
            canvas.toBlob(blob => {
                if (!blob) {
                    reject(
                        new Error('canvas.toBlob() failed')
                    );
                    return;
                }

                resolve(blob);
            }, type);
        });
    }


    // ============================================================
    // Cocos Node 탐색
    // ============================================================

    function findNodeRecursive(root, name) {
        if (!root) return null;

        if (root.name === name) {
            return root;
        }

        for (const child of root.children || []) {
            const found =
                findNodeRecursive(child, name);

            if (found) return found;
        }

        return null;
    }

    function findChildPath(root, names) {
        let node = root;

        for (const name of names) {
            if (!node) return null;

            node =
                node.getChildByName?.(name) ||
                (node.children || [])
                    .find(x => x.name === name);

            if (!node) return null;
        }

        return node;
    }

    function findDescendantByName(root, name) {
        if (!root) return null;

        if (root.name === name) {
            return root;
        }

        for (const child of root.children || []) {
            const result =
                findDescendantByName(
                    child,
                    name
                );

            if (result) return result;
        }

        return null;
    }


    // ============================================================
    // 기지 외관 content 찾기
    // ============================================================

    function getUserInfoPanel() {
        const scene = cc.director.getScene();

        const panel =
            findNodeRecursive(
                scene,
                'UserInfoMainPanel'
            );

        if (!panel) {
            throw new Error(
                'UserInfoMainPanel을 찾지 못했습니다. 개인정보 > 기지 외관 화면을 열어주세요.'
            );
        }

        return panel;
    }

    function getSkinContent() {
        const panel =
            getUserInfoPanel();

        const content =
            findChildPath(
                panel,
                [
                    'contentNode',
                    'towerNode',
                    'skinNode',
                    'allTowerNode',
                    'view',
                    'content'
                ]
            );

        if (!content) {
            throw new Error(
                '기지 외관 content 노드를 찾지 못했습니다.'
            );
        }

        return content;
    }


    // ============================================================
    // Tower Controller 탐색
    // ============================================================

    function findTowerController() {
        const content =
            getSkinContent();

        let node = content;

        while (node) {
            for (const comp of node._components || []) {

                if (
                    typeof comp?.getSkinCfg === 'function' &&
                    typeof comp?.refreshBuffContent === 'function'
                ) {
                    return comp;
                }
            }

            node = node.parent;
        }

        // 아이템 기준으로도 검색
        const firstItem =
            (content.children || [])[0];

        node = firstItem;

        for (
            let level = 0;
            level < 10 && node;
            level++
        ) {
            for (const comp of node._components || []) {
                if (
                    typeof comp?.getSkinCfg === 'function' &&
                    typeof comp?.refreshBuffContent === 'function'
                ) {
                    return comp;
                }
            }

            node = node.parent;
        }

        throw new Error(
            'Tower Controller를 찾지 못했습니다.'
        );
    }


    // ============================================================
    // Skin 목록
    // ============================================================

    function getSkinItems() {
        const content =
            getSkinContent();

        return (content.children || [])
            .filter(node => {
                return /^\d+$/.test(
                    String(node.name)
                );
            });
    }

    function getSkinItem(skinId) {
        const id = String(skinId);

        return getSkinItems()
            .find(x =>
                String(x.name) === id
            ) || null;
    }


    // ============================================================
    // Label 탐색
    // ============================================================

    function collectLabels(root, result = []) {
        if (!root) return result;

        try {
            const label =
                root.getComponent?.(cc.Label);

            if (
                label &&
                typeof label.string === 'string' &&
                label.string.trim()
            ) {
                result.push({
                    node: root.name,
                    text: label.string.trim()
                });
            }
        } catch {}

        for (const child of root.children || []) {
            collectLabels(
                child,
                result
            );
        }

        return result;
    }

    function guessSkinName(item) {
        if (!item) return '';

        const labels =
            collectLabels(item);

        const ignored =
            /^(lv\.?|new|use|using|보유|미보유|사용|장착|\d+|\+\d+)/i;

        const candidates =
            labels.filter(x =>
                x.text &&
                !ignored.test(x.text)
            );

        if (!candidates.length) {
            return '';
        }

        candidates.sort(
            (a, b) =>
                b.text.length -
                a.text.length
        );

        return candidates[0].text;
    }


    // ============================================================
    // SpriteFrame
    // ============================================================

    function getSkinSpriteFrame(item) {
        if (!item) return null;

        const icon =
            findDescendantByName(
                item,
                'icon'
            );

        if (!icon) return null;

        const sprite =
            icon.getComponent?.(cc.Sprite);

        return (
            sprite?.spriteFrame ||
            null
        );
    }


    // ============================================================
    // SpriteFrame UV
    // ============================================================

    function normalizeUv(sf) {
        let uv =
            sf?.uv ||
            sf?._uv;

        if (!uv) {
            return null;
        }

        const points = [];

        // [u,v,u,v,...]
        if (
            Array.isArray(uv) &&
            uv.length >= 8 &&
            typeof uv[0] === 'number'
        ) {
            for (
                let i = 0;
                i + 1 < uv.length;
                i += 2
            ) {
                points.push({
                    u: Number(uv[i]),
                    v: Number(uv[i + 1])
                });
            }

            return points;
        }

        // [{x,y}, ...]
        if (Array.isArray(uv)) {
            for (const p of uv) {
                if (
                    p &&
                    typeof p === 'object'
                ) {
                    const u =
                        p.u ??
                        p.x;

                    const v =
                        p.v ??
                        p.y;

                    if (
                        Number.isFinite(u) &&
                        Number.isFinite(v)
                    ) {
                        points.push({
                            u: Number(u),
                            v: Number(v)
                        });
                    }
                }
            }
        }

        return points.length
            ? points
            : null;
    }

    function calculateUvCrop(
        sf,
        imageWidth,
        imageHeight
    ) {
        const points =
            normalizeUv(sf);

        if (
            !points ||
            !points.length
        ) {
            throw new Error(
                'SpriteFrame UV를 읽지 못했습니다.'
            );
        }

        const us =
            points.map(p => p.u);

        const vs =
            points.map(p => p.v);

        const minU =
            Math.min(...us);

        const maxU =
            Math.max(...us);

        const minV =
            Math.min(...vs);

        const maxV =
            Math.max(...vs);

        const x =
            Math.round(
                minU * imageWidth
            );

        const y =
            Math.round(
                minV * imageHeight
            );

        const width =
            Math.round(
                (maxU - minU) *
                imageWidth
            );

        const height =
            Math.round(
                (maxV - minV) *
                imageHeight
            );

        return {
            x,
            y,
            width,
            height,

            minU,
            maxU,
            minV,
            maxV,

            uv: points
        };
    }


    // ============================================================
    // Texture URL
    // ============================================================

    function getTextureObject(sf) {
        try {
            if (
                typeof sf?.getTexture ===
                'function'
            ) {
                const t =
                    sf.getTexture();

                if (t) return t;
            }
        } catch {}

        return (
            sf?._texture ||
            null
        );
    }

    function getTextureUrl(sf) {
        const texture =
            getTextureObject(sf);

        if (!texture) {
            return null;
        }

        const candidates = [
            texture.url,
            texture._url,
            texture.nativeUrl,
            texture._nativeUrl,

            texture._nativeAsset?.src,
            texture._nativeAsset?.currentSrc,

            texture._image?.src,
            texture._image?.currentSrc,

            texture.image?.src,
            texture.image?.currentSrc
        ];

        for (let url of candidates) {
            if (
                typeof url !== 'string' ||
                !url.trim()
            ) {
                continue;
            }

            url = url.trim();

            try {
                return new URL(
                    url,
                    location.href
                ).href;
            } catch {
                return url;
            }
        }

        return null;
    }


    // ============================================================
    // Atlas loader
    // ============================================================

    const imageCache =
        new Map();

    function loadImage(url) {
        if (imageCache.has(url)) {
            return imageCache.get(url);
        }

        const promise =
            new Promise(
                (resolve, reject) => {
                    const img =
                        new Image();

                    img.onload =
                        () => resolve(img);

                    img.onerror =
                        () => reject(
                            new Error(
                                `이미지 로드 실패: ${url}`
                            )
                        );

                    img.src = url;
                }
            );

        imageCache.set(
            url,
            promise
        );

        return promise;
    }


    // ============================================================
    // Canvas Crop / Rotate
    // ============================================================

    function cropImage(
        image,
        crop
    ) {
        const canvas =
            document.createElement(
                'canvas'
            );

        canvas.width =
            crop.width;

        canvas.height =
            crop.height;

        const ctx =
            canvas.getContext('2d');

        ctx.drawImage(
            image,

            crop.x,
            crop.y,
            crop.width,
            crop.height,

            0,
            0,
            crop.width,
            crop.height
        );

        return canvas;
    }

    function rotateCanvas(
        source,
        degree
    ) {
        degree =
            ((degree % 360) + 360) %
            360;

        if (degree === 0) {
            return source;
        }

        const canvas =
            document.createElement(
                'canvas'
            );

        if (
            degree === 90 ||
            degree === 270
        ) {
            canvas.width =
                source.height;

            canvas.height =
                source.width;
        } else {
            canvas.width =
                source.width;

            canvas.height =
                source.height;
        }

        const ctx =
            canvas.getContext('2d');

        ctx.translate(
            canvas.width / 2,
            canvas.height / 2
        );

        ctx.rotate(
            degree *
            Math.PI /
            180
        );

        ctx.drawImage(
            source,
            -source.width / 2,
            -source.height / 2
        );

        return canvas;
    }

    function getRestoreRotation(sf) {
        const rotated =
            sf?.rotated ??
            sf?._rotated ??
            false;

        /*
         * Atlas에서 rotated 된 SpriteFrame은
         * 기존 테스트 기준 270도 복원.
         *
         * rotated=false는 0도.
         */
        return rotated
            ? 270
            : 0;
    }


    // ============================================================
    // 이미지 추출
    // ============================================================

    async function getSkinImageCanvas(
        skinId,
        options = {}
    ) {
        const item =
            getSkinItem(skinId);

        if (!item) {
            throw new Error(
                `Skin item not found: ${skinId}`
            );
        }

        const sf =
            getSkinSpriteFrame(item);

        if (!sf) {
            throw new Error(
                `icon SpriteFrame not found: ${skinId}`
            );
        }

        const url =
            getTextureUrl(sf);

        if (!url) {
            throw new Error(
                `Texture URL not found: ${skinId}`
            );
        }

        const image =
            await loadImage(url);

        const crop =
            calculateUvCrop(
                sf,
                image.naturalWidth ||
                    image.width,
                image.naturalHeight ||
                    image.height
            );

        const cropped =
            cropImage(
                image,
                crop
            );

        const rotation =
            options.rotation ??
            getRestoreRotation(sf);

        const finalCanvas =
            rotateCanvas(
                cropped,
                rotation
            );

        return {
            canvas:
                finalCanvas,

            atlasUrl:
                url,

            rotation,

            crop,

            spriteFrameName:
                sf.name ||
                sf._name ||
                '',

            rotated:
                sf.rotated ??
                sf._rotated ??
                false
        };
    }


    // ============================================================
    // BUFF 읽기
    // ============================================================

    function readBuffContainer(
        container
    ) {
        if (!container) {
            return [];
        }

        const result = [];

        for (
            const item
            of container.children || []
        ) {
            if (
                !item ||
                item.isValid === false
            ) {
                continue;
            }

            const nameNode =
                item.getChildByName?.(
                    'name'
                );

            const numNode =
                item.getChildByName?.(
                    'num'
                );

            const detailBtn =
                item.getChildByName?.(
                    'detailBtn'
                );

            const nameLabel =
                nameNode?.getComponent?.(
                    cc.Label
                );

            const numLabel =
                numNode?.getComponent?.(
                    cc.Label
                );

            result.push({
                name:
                    nameLabel?.string ||
                    '',

                value:
                    numLabel?.string ||
                    '',

                detailId:
                    (
                        detailBtn?.active &&
                        detailBtn?.name
                    )
                        ? detailBtn.name
                        : null
            });
        }

        return result;
    }

    function parseRawBuffString(str) {
        if (!str) return [];

        return String(str)
            .split('|')
            .filter(Boolean)
            .map(part => {
                const pieces =
                    part.split(',');

                return {
                    buffId:
                        Number(
                            pieces[0]
                        ),

                    value:
                        Number(
                            pieces[1]
                        ),

                    detailId:
                        pieces[2] ||
                        null
                };
            });
    }


    // ============================================================
    // 현재 UI 상태 일부 보관
    // ============================================================

    function saveUiState(c) {
        return {
            skinId:
                c._skinId,

            skinCfg:
                c._skincfg,

            useBuffContent:
                c.useBuffContent,

            ownBuffContent:
                c.ownBuffContent,

            useDesActive:
                c.useDesNode?.active,

            haveDesActive:
                c.haveDesNode?.active,

            skinLinkActive:
                c.skinLinkLabel?.node?.active,

            skinLinkText:
                c.skinLinkLabel?.string,

            descExcludeActive:
                c.descExclude?.node?.active,

            descExcludeText:
                c.descExclude?.string
        };
    }

    function restoreUiState(
        c,
        state
    ) {
        c._skinId =
            state.skinId;

        c._skincfg =
            state.skinCfg;

        c.useBuffContent =
            state.useBuffContent;

        c.ownBuffContent =
            state.ownBuffContent;

        try {
            if (c.useDesNode) {
                c.useDesNode.active =
                    state.useDesActive;
            }
        } catch {}

        try {
            if (c.haveDesNode) {
                c.haveDesNode.active =
                    state.haveDesActive;
            }
        } catch {}

        try {
            if (c.skinLinkLabel) {
                c.skinLinkLabel.node.active =
                    state.skinLinkActive;

                c.skinLinkLabel.string =
                    state.skinLinkText;
            }
        } catch {}

        try {
            if (c.descExclude) {
                c.descExclude.node.active =
                    state.descExcludeActive;

                c.descExclude.string =
                    state.descExcludeText;
            }
        } catch {}
    }


    // ============================================================
    // 버프 텍스트 추출
    //
    // 핵심:
    // 실제 UI container가 아니라 임시 Node를 넣는다.
    // → safetyDestroyAllChildren() 중복 문제 방지
    // ============================================================

    function getSkinBuffText(
        skinId
    ) {
        const c =
            findTowerController();

        const id =
            Number(skinId);

        const cfg =
            c.getSkinCfg(id);

        if (!cfg) {
            return null;
        }

        const state =
            saveUiState(c);

        const tempUse =
            new cc.Node(
                '__TempEquipBuff'
            );

        const tempOwn =
            new cc.Node(
                '__TempOwnBuff'
            );

        try {
            c.useBuffContent =
                tempUse;

            c.ownBuffContent =
                tempOwn;

            c._skinId =
                id;

            c._skincfg =
                cfg;

            c.refreshBuffContent();

            const equipBuff =
                readBuffContainer(
                    tempUse
                );

            const ownBuff =
                readBuffContainer(
                    tempOwn
                );

            return {
                skinId:
                    id,

                nameKey:
                    cfg.name || '',

                descKey:
                    cfg.desc || '',

                raw: {
                    equipBuff:
                        cfg.equip_buff || '',

                    ownBuff:
                        cfg.own_buff || ''
                },

                rawParsed: {
                    equipBuff:
                        parseRawBuffString(
                            cfg.equip_buff
                        ),

                    ownBuff:
                        parseRawBuffString(
                            cfg.own_buff
                        )
                },

                equipBuff,
                ownBuff
            };

        } finally {

            restoreUiState(
                c,
                state
            );

            safeDestroy(
                tempUse
            );

            safeDestroy(
                tempOwn
            );
        }
    }


    // ============================================================
    // Skin 정보
    // ============================================================

    function getSkin(
        skinId
    ) {
        const id =
            Number(skinId);

        const item =
            getSkinItem(id);

        if (!item) {
            return null;
        }

        const c =
            findTowerController();

        const cfg =
            c.getSkinCfg(id);

        return {
            id,
            item,
            cfg,

            name:
                guessSkinName(item),

            nameKey:
                cfg?.name || '',

            descKey:
                cfg?.desc || ''
        };
    }


    // ============================================================
    // 단일 Skin 데이터
    // ============================================================

    function getSkinData(
        skinId
    ) {
        const skin =
            getSkin(skinId);

        if (!skin) {
            return null;
        }

        const buff =
            getSkinBuffText(
                skinId
            );

        const cfg =
            skin.cfg || {};

        return {
            id:
                skin.id,

            name:
                skin.name,

            nameKey:
                cfg.name || '',

            descKey:
                cfg.desc || '',

            sprite:
                cfg.pic || '',

            spriteNew:
                cfg.pic_new || '',

            anim:
                cfg.anim || '',

            skinGroup:
                cfg.skin_group ?? null,

            skinLevel:
                cfg.skin_level ?? null,

            maxLevel:
                cfg.max_level ?? null,

            order:
                cfg.order ?? null,

            equipBuff:
                buff?.equipBuff || [],

            ownBuff:
                buff?.ownBuff || [],

            rawEquipBuff:
                buff?.raw?.equipBuff || '',

            rawOwnBuff:
                buff?.raw?.ownBuff || '',

            rawParsedEquipBuff:
                buff?.rawParsed?.equipBuff || [],

            rawParsedOwnBuff:
                buff?.rawParsed?.ownBuff || []
        };
    }


    // ============================================================
    // 전체 데이터
    // ============================================================

    function getAllData() {
        const items =
            getSkinItems();

        const result = [];

        for (const item of items) {
            const id =
                Number(item.name);

            try {
                const data =
                    getSkinData(id);

                if (data) {
                    result.push(data);
                }
            } catch (e) {
                console.warn(
                    `[${id}] 데이터 추출 실패`,
                    e
                );

                result.push({
                    id,
                    error:
                        String(
                            e?.message ||
                            e
                        )
                });
            }
        }

        return result;
    }


    // ============================================================
    // 출력
    // ============================================================

    function print() {
        const data =
            getAllData();

        console.table(
            data.map(x => ({
                id:
                    x.id,

                name:
                    x.name,

                equipBuff:
                    (x.equipBuff || [])
                        .map(b =>
                            `${b.name} ${b.value}`
                        )
                        .join(' / '),

                ownBuff:
                    (x.ownBuff || [])
                        .map(b =>
                            `${b.name} ${b.value}`
                        )
                        .join(' / ')
            }))
        );

        return data;
    }


    // ============================================================
    // 단일 이미지 Export
    // ============================================================

    async function exportOne(
        skinId,
        options = {}
    ) {
        const skin =
            getSkin(skinId);

        if (!skin) {
            throw new Error(
                `Skin not found: ${skinId}`
            );
        }

        const image =
            await getSkinImageCanvas(
                skinId,
                options
            );

        const filename =
            sanitizeFilename(
                `${skinId}_${skin.name || 'skin'}.png`
            );

        if (
            options.download !== false
        ) {
            const blob =
                await canvasToBlob(
                    image.canvas
                );

            downloadBlob(
                blob,
                filename
            );
        }

        return {
            skin:
                getSkinData(
                    skinId
                ),

            image
        };
    }


    // ============================================================
    // 전체 이미지 Export
    // ============================================================

    async function exportAllImages(
        options = {}
    ) {
        const items =
            getSkinItems();

        const delay =
            options.delay ?? 150;

        const result = [];

        for (
            let i = 0;
            i < items.length;
            i++
        ) {
            const id =
                Number(
                    items[i].name
                );

            console.log(
                `[${i + 1}/${items.length}] 이미지 추출: ${id}`
            );

            try {
                const r =
                    await exportOne(
                        id,
                        {
                            download:
                                options.download !== false
                        }
                    );

                result.push({
                    id,
                    ok: true,
                    rotation:
                        r.image.rotation,
                    atlasUrl:
                        r.image.atlasUrl
                });

            } catch (e) {
                console.warn(
                    `[${id}] 이미지 실패`,
                    e
                );

                result.push({
                    id,
                    ok: false,
                    error:
                        String(
                            e?.message ||
                            e
                        )
                });
            }

            if (delay > 0) {
                await sleep(delay);
            }
        }

        return result;
    }


    // ============================================================
    // JSON Export
    // ============================================================

    function exportMetadata(
        filename =
            'topwar_castle_skins.json'
    ) {
        const data =
            getAllData();

        downloadText(
            JSON.stringify(
                data,
                null,
                2
            ),
            filename
        );

        return data;
    }


    // ============================================================
    // CSV Export
    // ============================================================

    function csvEscape(value) {
        const str =
            String(
                value ?? ''
            );

        return (
            '"' +
            str.replace(
                /"/g,
                '""'
            ) +
            '"'
        );
    }

    function exportCSV(
        filename =
            'topwar_castle_skins.csv'
    ) {
        const data =
            getAllData();

        const rows = [
            [
                'id',
                'name',
                'nameKey',
                'skinGroup',
                'skinLevel',
                'maxLevel',
                'equipBuff',
                'ownBuff',
                'rawEquipBuff',
                'rawOwnBuff'
            ]
        ];

        for (const x of data) {
            rows.push([
                x.id,
                x.name,
                x.nameKey,
                x.skinGroup,
                x.skinLevel,
                x.maxLevel,

                (x.equipBuff || [])
                    .map(b =>
                        `${b.name} ${b.value}`
                    )
                    .join(' | '),

                (x.ownBuff || [])
                    .map(b =>
                        `${b.name} ${b.value}`
                    )
                    .join(' | '),

                x.rawEquipBuff,
                x.rawOwnBuff
            ]);
        }

        const csv =
            '\uFEFF' +
            rows
                .map(row =>
                    row
                        .map(csvEscape)
                        .join(',')
                )
                .join('\r\n');

        downloadText(
            csv,
            filename,
            'text/csv'
        );

        return data;
    }


    // ============================================================
    // 검사
    // ============================================================

    function inspect(
        skinId
    ) {
        const skin =
            getSkin(skinId);

        if (!skin) {
            console.warn(
                'Skin not found:',
                skinId
            );

            return null;
        }

        const sf =
            getSkinSpriteFrame(
                skin.item
            );

        const buff =
            getSkinBuffText(
                skinId
            );

        const result = {
            skin:
                getSkinData(
                    skinId
                ),

            spriteFrame: {
                name:
                    sf?.name ||
                    sf?._name,

                rotated:
                    sf?.rotated ??
                    sf?._rotated,

                rotation:
                    sf
                        ? getRestoreRotation(sf)
                        : null,

                uv:
                    sf
                        ? normalizeUv(sf)
                        : null,

                textureUrl:
                    sf
                        ? getTextureUrl(sf)
                        : null
            },

            buff
        };

        console.log(
            result
        );

        return result;
    }


    // ============================================================
    // API 공개
    // ============================================================

    const api = {
        version:
            VERSION,

        getPanel:
            getUserInfoPanel,

        getContent:
            getSkinContent,

        getController:
            findTowerController,

        getItems:
            getSkinItems,

        getItem:
            getSkinItem,

        getSkin,
        getSkinData,
        getAllData,

        getBuff:
            getSkinBuffText,

        getSpriteFrame:
            skinId => {
                const item =
                    getSkinItem(
                        skinId
                    );

                return (
                    item
                        ? getSkinSpriteFrame(item)
                        : null
                );
            },

        inspect,

        print,

        getImage:
            getSkinImageCanvas,

        exportOne,

        exportAllImages,

        exportMetadata,

        exportCSV,

        calculateUvCrop,

        normalizeUv,

        getRestoreRotation,

        rotateCanvas,

        cropImage
    };

    window.TopWarSkinExporter =
        api;

    window.__towerController =
        findTowerController();

    console.log(
        `%c[TopWarSkinExporter] READY ${VERSION}`,
        'font-weight:bold'
    );

    console.log(
        '스킨 수:',
        getSkinItems().length
    );

    console.log(
        '사용 예시:',
        `
TopWarSkinExporter.print()

TopWarSkinExporter.getBuff(2000000)

TopWarSkinExporter.inspect(2000000)

TopWarSkinExporter.exportOne(2000000)

TopWarSkinExporter.exportMetadata()

TopWarSkinExporter.exportCSV()

TopWarSkinExporter.exportAllImages()
        `
    );

    return api;
})();
