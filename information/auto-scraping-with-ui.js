(() => {
    'use strict';

    /*
     * ============================================================
     * TopWar Appearance Manager v0.3
     * ============================================================
     *
     * 대상
     * - 기지 외관     SKIN
     * - 대열 외관     MARCH_SKIN
     * - 기지 효과     CASTLEEFFECT
     * - 기지 오라     castle_halo
     *
     * 기능
     * - 최소화 가능한 관리자 UI
     * - 4종 외형 조회
     * - 이미지 미리보기
     * - Config 자동 탐색
     * - equip_buff / own_buff 수집
     * - JSON 생성
     * - PNG 생성
     * - apperance.zip 한방 다운로드
     *
     * ZIP 결과
     *
     * apperance/
     *   index.json
     *
     *   castle/
     *     data.json
     *     images/
     *
     *   army-line/
     *     data.json
     *     images/
     *
     *   city-effect/
     *     data.json
     *     images/
     *
     *   castle-halo/
     *     data.json
     *     images/
     * ============================================================
     */


    const VERSION = '0.3.0';


    /* ============================================================
     * 이전 버전 제거
     * ============================================================ */

    try {
        window.TopWarAppearanceManager?.destroy?.();
    } catch {}

    document
        .getElementById('tw-appearance-manager')
        ?.remove();

    document
        .getElementById('tw-appearance-manager-style')
        ?.remove();


    /* ============================================================
     * 카테고리 정의
     * ============================================================ */

    const CATEGORY = {

        castle: {
            key: 'castle',
            folder: 'castle',
            name: '기지 외관',

            rootNames: [
                'skinNode'
            ],

            iconNames: [
                'icon'
            ]
        },

        armyLine: {
            key: 'armyLine',
            folder: 'army-line',
            name: '대열 외관',

            rootNames: [
                'armyLineSkinNode'
            ],

            iconNames: [
                'icon'
            ]
        },

        cityEffect: {
            key: 'cityEffect',
            folder: 'city-effect',
            name: '기지 효과',

            rootNames: [
                'CityEffectNode'
            ],

            iconNames: [
                'icon'
            ]
        },

        castleHalo: {
            key: 'castleHalo',
            folder: 'castle-halo',
            name: '기지 오라',

            rootNames: [
                'CastleHaloNode'
            ],

            iconNames: [
                'iconSp'
            ]
        }
    };


    /* ============================================================
     * 상태
     * ============================================================ */

    const state = {

        category: 'castle',

        minimized: false,

        items: {
            castle: [],
            armyLine: [],
            cityEffect: [],
            castleHalo: []
        },

        controllers: {},

        selected: null,

        imageCache: new Map(),

        exporting: false
    };


    /* ============================================================
     * 로그
     * ============================================================ */

    function log(...args) {

        console.log(
            '%c[TopWarAppearance]',
            'color:#4fc3f7;font-weight:bold',
            ...args
        );
    }


    function warn(...args) {

        console.warn(
            '[TopWarAppearance]',
            ...args
        );
    }


    /* ============================================================
     * Cocos Node 탐색
     * ============================================================ */

    function walk(
        node,
        callback,
        path = ''
    ) {

        if (!node)
            return;

        const currentPath =
            path
                ? `${path}/${node.name}`
                : node.name;

        callback(
            node,
            currentPath
        );

        for (
            const child
            of node.children || []
        ) {

            walk(
                child,
                callback,
                currentPath
            );
        }
    }


    function findNodeByNames(
        root,
        names
    ) {

        let result = null;

        walk(
            root,
            node => {

                if (result)
                    return;

                if (
                    names.includes(
                        node.name
                    )
                ) {
                    result = node;
                }
            }
        );

        return result;
    }


    function findCategoryRoot(key) {

        const scene =
            cc.director.getScene();

        if (!scene)
            return null;

        return findNodeByNames(
            scene,
            CATEGORY[key].rootNames
        );
    }


    /* ============================================================
     * Sprite 관련
     * ============================================================ */

    function getSpriteFrame(node) {

        try {

            const sprite =
                node.getComponent?.(
                    cc.Sprite
                );

            return (
                sprite?.spriteFrame ||
                null
            );

        } catch {

            return null;
        }
    }


    function getTexture(sf) {

        try {

            return (
                sf?.getTexture?.() ||
                sf?._texture ||
                null
            );

        } catch {

            return null;
        }
    }


    function getTextureUrl(sf) {

        const tex =
            getTexture(sf);

        if (!tex)
            return '';

        return (
            tex.url ||
            tex._url ||
            tex.nativeUrl ||
            tex._nativeUrl ||
            ''
        );
    }


    function normalizeTextureUrl(url) {

        if (!url)
            return '';

        if (
            /^https?:\/\//i.test(url)
        ) {
            return url;
        }

        if (
            url.startsWith('//')
        ) {
            return (
                location.protocol +
                url
            );
        }

        if (
            url.startsWith('/')
        ) {
            return (
                location.origin +
                url
            );
        }

        if (
            url.startsWith('assets/')
        ) {
            return (
                location.origin +
                '/h5game/' +
                url
            );
        }

        return new URL(
            url,
            location.href
        ).href;
    }


    function getSpriteInfo(sf) {

        if (!sf)
            return null;

        let rect = null;
        let uv = null;
        let originalSize = null;

        try {

            rect =
                sf.getRect?.() ||
                sf._rect ||
                null;

        } catch {}


        try {

            uv =
                sf.uv ||
                sf._uv ||
                null;

        } catch {}


        try {

            originalSize =
                sf.getOriginalSize?.() ||
                sf._originalSize ||
                null;

        } catch {}


        const textureUrl =
            getTextureUrl(sf);


        return {

            name:
                sf.name || '',

            rotated:
                sf.rotated ??
                sf._rotated ??
                false,

            rect,

            uv,

            originalSize,

            textureUrl,

            fullTextureUrl:
                normalizeTextureUrl(
                    textureUrl
                )
        };
    }


    /* ============================================================
     * Image 로드
     * ============================================================ */

    function loadImage(url) {

        if (
            state.imageCache.has(url)
        ) {
            return state.imageCache.get(
                url
            );
        }


        const promise =
            new Promise(
                (resolve, reject) => {

                    const img =
                        new Image();

                    img.crossOrigin =
                        'anonymous';

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


        state.imageCache.set(
            url,
            promise
        );


        return promise;
    }


    /* ============================================================
     * UV Bounds
     * ============================================================ */

    function getUVBounds(sf) {

        const uv =
            sf?.uv ||
            sf?._uv;

        if (
            !uv ||
            !uv.length
        ) {
            return null;
        }


        const xs = [];
        const ys = [];


        if (
            typeof uv[0] === 'number'
        ) {

            for (
                let i = 0;
                i < uv.length - 1;
                i += 2
            ) {

                xs.push(
                    Number(uv[i])
                );

                ys.push(
                    Number(uv[i + 1])
                );
            }

        } else {

            for (
                const point
                of uv
            ) {

                if (
                    point &&
                    typeof point.x === 'number' &&
                    typeof point.y === 'number'
                ) {

                    xs.push(
                        point.x
                    );

                    ys.push(
                        point.y
                    );
                }
            }
        }


        if (
            !xs.length ||
            !ys.length
        ) {
            return null;
        }


        return {

            minX:
                Math.min(...xs),

            maxX:
                Math.max(...xs),

            minY:
                Math.min(...ys),

            maxY:
                Math.max(...ys)
        };
    }


    /* ============================================================
     * SpriteFrame → Canvas
     * ============================================================ */

    async function spriteFrameToCanvas(sf) {

        if (!sf)
            throw new Error(
                'SpriteFrame 없음'
            );


        const info =
            getSpriteInfo(sf);

        if (!info?.fullTextureUrl)
            throw new Error(
                'Texture URL 없음'
            );


        const atlas =
            await loadImage(
                info.fullTextureUrl
            );


        const bounds =
            getUVBounds(sf);


        let sx;
        let sy;
        let sw;
        let sh;


        /*
         * 우선 UV
         */

        if (bounds) {

            sx =
                Math.round(
                    bounds.minX *
                    atlas.naturalWidth
                );

            sy =
                Math.round(
                    bounds.minY *
                    atlas.naturalHeight
                );

            sw =
                Math.round(
                    (
                        bounds.maxX -
                        bounds.minX
                    ) *
                    atlas.naturalWidth
                );

            sh =
                Math.round(
                    (
                        bounds.maxY -
                        bounds.minY
                    ) *
                    atlas.naturalHeight
                );

        } else {

            const rect =
                info.rect;

            if (!rect)
                throw new Error(
                    'UV / Rect 없음'
                );

            sx = rect.x;
            sy = rect.y;

            sw = rect.width;
            sh = rect.height;
        }


        if (
            !sw ||
            !sh ||
            sw <= 0 ||
            sh <= 0
        ) {
            throw new Error(
                `잘못된 이미지 크기 ${sw} x ${sh}`
            );
        }


        const crop =
            document.createElement(
                'canvas'
            );

        crop.width = sw;
        crop.height = sh;


        crop
            .getContext('2d')
            .drawImage(
                atlas,

                sx,
                sy,
                sw,
                sh,

                0,
                0,
                sw,
                sh
            );


        const rotated =
            sf.rotated ??
            sf._rotated ??
            false;


        if (!rotated)
            return crop;


        /*
         * 기존 테스트에서 검증한 Cocos atlas rotation 복원
         */

        const output =
            document.createElement(
                'canvas'
            );

        output.width = sh;
        output.height = sw;


        const ctx =
            output.getContext('2d');


        ctx.translate(
            0,
            output.height
        );

        ctx.rotate(
            -Math.PI / 2
        );

        ctx.drawImage(
            crop,
            0,
            0
        );


        return output;
    }


    function canvasToBlob(canvas) {

        return new Promise(
            (resolve, reject) => {

                canvas.toBlob(
                    blob => {

                        if (blob)
                            resolve(blob);
                        else
                            reject(
                                new Error(
                                    'PNG 변환 실패'
                                )
                            );
                    },

                    'image/png'
                );
            }
        );
    }


    /* ============================================================
     * ID 판별
     * ============================================================ */

    function detectItemId(
        category,
        node,
        sf
    ) {

        /*
         * 기지 / 대열
         * 부모 중 숫자 Node가 ID
         */

        if (
            category === 'castle' ||
            category === 'armyLine'
        ) {

            let p = node;

            while (p) {

                if (
                    /^\d+$/.test(
                        p.name || ''
                    )
                ) {

                    return (
                        p.name
                    );
                }

                p = p.parent;
            }
        }


        /*
         * 기지 효과
         */

        if (
            category === 'cityEffect'
        ) {

            const match =
                String(
                    sf?.name || ''
                ).match(
                    /Castle_Effect_(\d+)_pic/i
                );

            if (match)
                return match[1];
        }


        /*
         * 기지 오라
         */

        if (
            category === 'castleHalo'
        ) {

            let match =
                String(
                    sf?.name || ''
                ).match(
                    /Castle_halo_(\d+)_pic/i
                );

            if (match)
                return match[1];


            match =
                String(
                    sf?.name || ''
                ).match(
                    /Castle_Effect_(\d+)_pic/i
                );

            if (match)
                return match[1];
        }


        return '';
    }


    /* ============================================================
     * 아이템 Root
     * ============================================================ */

    function findItemRoot(
        category,
        iconNode
    ) {

        let p =
            iconNode;

        if (
            category === 'castle' ||
            category === 'armyLine'
        ) {

            while (p) {

                if (
                    /^\d+$/.test(
                        p.name || ''
                    )
                ) {
                    return p;
                }

                p = p.parent;
            }
        }


        if (
            category === 'cityEffect'
        ) {

            while (p) {

                if (
                    p.name ===
                    'CastleItem'
                ) {
                    return p;
                }

                p = p.parent;
            }
        }


        if (
            category === 'castleHalo'
        ) {

            while (p) {

                if (
                    p.name ===
                    'CastleHaloItem'
                ) {
                    return p;
                }

                p = p.parent;
            }
        }


        return (
            iconNode.parent ||
            iconNode
        );
    }


    /* ============================================================
     * Label 읽기
     * ============================================================ */

    function collectLabels(root) {

        const result = [];

        walk(
            root,
            node => {

                try {

                    const label =
                        node.getComponent?.(
                            cc.Label
                        );

                    if (
                        label &&
                        String(
                            label.string || ''
                        ).trim()
                    ) {

                        result.push(
                            String(
                                label.string
                            ).trim()
                        );
                    }

                } catch {}
            }
        );

        return result;
    }


    function detectDisplayName(
        itemRoot,
        id
    ) {

        if (!itemRoot)
            return '';


        const labels =
            collectLabels(
                itemRoot
            );


        const ignored =
            new Set([
                String(id),
                'NEW',
                'New'
            ]);


        const candidates =
            labels.filter(
                text => {

                    if (
                        !text ||
                        ignored.has(text)
                    ) {
                        return false;
                    }

                    if (
                        /^\d+$/.test(text)
                    ) {
                        return false;
                    }

                    if (
                        /^\+?\d+(\.\d+)?%?$/
                            .test(text)
                    ) {
                        return false;
                    }

                    return true;
                }
            );


        candidates.sort(
            (a, b) =>
                b.length -
                a.length
        );


        return (
            candidates[0] ||
            ''
        );
    }


    /* ============================================================
     * Config 탐색
     * ============================================================ */

    function looksLikeConfig(obj) {

        if (
            !obj ||
            typeof obj !== 'object' ||
            Array.isArray(obj)
        ) {
            return false;
        }


        const keys =
            Object.keys(obj);


        return (
            'id' in obj &&
            (
                'name' in obj ||
                'equip_buff' in obj ||
                'own_buff' in obj ||
                'icon' in obj ||
                'pic' in obj ||
                'anim' in obj ||
                'prefab' in obj ||
                'is_show' in obj
            )
        );
    }


    function idEqual(a, b) {

        return (
            String(a) ===
            String(b)
        );
    }


    function findConfigInObject(
        source,
        id,
        depth = 0,
        visited = new WeakSet()
    ) {

        if (
            !source ||
            typeof source !== 'object'
        ) {
            return null;
        }


        if (
            depth > 4
        ) {
            return null;
        }


        if (
            visited.has(source)
        ) {
            return null;
        }


        visited.add(source);


        if (
            looksLikeConfig(source) &&
            idEqual(
                source.id,
                id
            )
        ) {

            return source;
        }


        if (
            source instanceof Node ||
            source instanceof Element
        ) {
            return null;
        }


        const skipKeys =
            new Set([
                'node',
                '_node',
                'parent',
                '_parent',
                'children',
                '_children',
                'spriteFrame',
                '_spriteFrame',
                '_texture',
                'texture',
                '_sgNode'
            ]);


        let keys;

        try {
            keys =
                Object.keys(source);
        } catch {
            return null;
        }


        for (
            const key
            of keys
        ) {

            if (
                skipKeys.has(key)
            ) {
                continue;
            }


            let value;

            try {
                value =
                    source[key];
            } catch {
                continue;
            }


            if (
                !value ||
                typeof value !==
                    'object'
            ) {
                continue;
            }


            if (
                Array.isArray(value)
            ) {

                for (
                    const child
                    of value
                ) {

                    if (
                        !child ||
                        typeof child !==
                            'object'
                    ) {
                        continue;
                    }


                    const found =
                        findConfigInObject(
                            child,
                            id,
                            depth + 1,
                            visited
                        );

                    if (found)
                        return found;
                }

                continue;
            }


            const found =
                findConfigInObject(
                    value,
                    id,
                    depth + 1,
                    visited
                );

            if (found)
                return found;
        }


        return null;
    }


    function findController(
        category,
        root
    ) {

        if (
            state.controllers[
                category
            ]
        ) {

            return state.controllers[
                category
            ];
        }


        let result = null;


        walk(
            root,
            node => {

                if (result)
                    return;


                for (
                    const comp
                    of node._components || []
                ) {

                    const proto =
                        Object.getPrototypeOf(
                            comp
                        );

                    const has =
                        name =>
                            typeof comp[
                                name
                            ] ===
                            'function' ||
                            typeof proto?.[
                                name
                            ] ===
                            'function';


                    if (
                        category === 'castle' &&
                        has('getSkinCfg') &&
                        has(
                            'refreshBuffContent'
                        )
                    ) {

                        result = comp;
                        return;
                    }


                    if (
                        category ===
                            'armyLine' &&
                        has('initcontent') &&
                        has(
                            'refreshBuffContent'
                        )
                    ) {

                        result = comp;
                        return;
                    }


                    if (
                        category ===
                            'cityEffect' &&
                        has(
                            'initEffectContent'
                        ) &&
                        has(
                            'refreshBuffContent'
                        )
                    ) {

                        result = comp;
                        return;
                    }


                    if (
                        category ===
                            'castleHalo' &&
                        has(
                            'initHaloCfg'
                        ) &&
                        has(
                            'addBuffItemToParent'
                        )
                    ) {

                        result = comp;
                        return;
                    }
                }
            }
        );


        if (result) {

            state.controllers[
                category
            ] = result;
        }


        return result;
    }


    function findConfig(
        category,
        id,
        itemRoot,
        controller
    ) {

        /*
         * 기지 외관은 getSkinCfg 직접 사용
         */

        if (
            category === 'castle' &&
            controller?.getSkinCfg
        ) {

            try {

                const cfg =
                    controller.getSkinCfg(
                        Number(id)
                    );

                if (cfg)
                    return cfg;

            } catch {}
        }


        /*
         * CastleHalo는 _dataList에 cfg가 존재하는 구조
         */

        if (
            category ===
                'castleHalo' &&
            Array.isArray(
                controller?._dataList
            )
        ) {

            for (
                const entry
                of controller._dataList
            ) {

                const cfg =
                    entry?.cfg ||
                    entry;

                if (
                    cfg &&
                    idEqual(
                        cfg.id,
                        id
                    )
                ) {

                    return cfg;
                }
            }
        }


        /*
         * 아이템 Component 내부 config 탐색
         */

        if (itemRoot) {

            for (
                const comp
                of itemRoot._components || []
            ) {

                const cfg =
                    findConfigInObject(
                        comp,
                        id
                    );

                if (cfg)
                    return cfg;
            }
        }


        /*
         * Controller 내부 fallback
         */

        if (controller) {

            const cfg =
                findConfigInObject(
                    controller,
                    id
                );

            if (cfg)
                return cfg;
        }


        return null;
    }


    /* ============================================================
     * Plain JSON 변환
     * ============================================================ */

    function sanitizeObject(
        value,
        depth = 0,
        visited = new WeakSet()
    ) {

        if (
            value === null ||
            value === undefined
        ) {
            return value ?? null;
        }


        if (
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
        ) {
            return value;
        }


        if (
            typeof value === 'function'
        ) {
            return undefined;
        }


        if (
            depth > 6
        ) {
            return undefined;
        }


        if (
            typeof value !== 'object'
        ) {
            return undefined;
        }


        if (
            visited.has(value)
        ) {
            return undefined;
        }


        visited.add(value);


        if (
            Array.isArray(value)
        ) {

            return value
                .map(
                    item =>
                        sanitizeObject(
                            item,
                            depth + 1,
                            visited
                        )
                )
                .filter(
                    item =>
                        item !==
                        undefined
                );
        }


        const out = {};


        for (
            const key
            of Object.keys(value)
        ) {

            if (
                key === 'node' ||
                key === '_node' ||
                key === 'parent' ||
                key === 'children' ||
                key === '_components'
            ) {
                continue;
            }


            let child;

            try {
                child =
                    value[key];
            } catch {
                continue;
            }


            const cleaned =
                sanitizeObject(
                    child,
                    depth + 1,
                    visited
                );


            if (
                cleaned !==
                undefined
            ) {
                out[key] =
                    cleaned;
            }
        }


        return out;
    }


    /* ============================================================
     * Buff 파싱
     * ============================================================ */

    function parseBuffString(
        string
    ) {

        if (!string)
            return [];


        return String(string)
            .split('|')
            .map(
                part =>
                    part.trim()
            )
            .filter(Boolean)
            .map(
                part => {

                    const fields =
                        part.split(',');


                    return {

                        buffId:
                            Number(
                                fields[0]
                            ),

                        rawValue:
                            fields[1] !==
                            undefined
                                ? Number(
                                    fields[1]
                                )
                                : null,

                        detail:
                            fields[2] ??
                            null,

                        raw:
                            part
                    };
                }
            );
    }


    function splitBuffText(text) {

        if (!text)
            return {
                name: '',
                value: ''
            };


        const match =
            String(text)
                .trim()
                .match(
                    /^(.*?)(\+\s*[-\d,.]+(?:\.\d+)?%?)$/
                );


        if (!match) {

            return {
                name:
                    String(text)
                        .trim(),

                value: ''
            };
        }


        return {

            name:
                match[1]
                    .trim(),

            value:
                match[2]
                    .replace(
                        /\s+/g,
                        ''
                    )
        };
    }


    /* ============================================================
     * 임시 Buff Container
     * ============================================================ */

    function createTempBuffNode() {

        const parent =
            new cc.Node(
                'TW_TEMP_PARENT'
            );

        const content =
            new cc.Node(
                'TW_TEMP_CONTENT'
            );

        parent.addChild(
            content
        );

        return {
            parent,
            content
        };
    }


    function readBuffChildren(
        content
    ) {

        const result = [];


        for (
            const child
            of content.children || []
        ) {

            const texts =
                collectLabels(
                    child
                )
                .filter(Boolean);


            if (!texts.length)
                continue;


            result.push(
                texts.join(' ')
                    .replace(
                        /\s+/g,
                        ' '
                    )
                    .trim()
            );
        }


        return result;
    }


    async function tryLocalizedBuffs(
        category,
        controller,
        cfg
    ) {

        if (
            !controller ||
            !cfg ||
            typeof controller
                .refreshBuffContent !==
                'function'
        ) {

            return null;
        }


        /*
         * 예전 기지용 Exporter가 살아있다면
         * 검증된 구현 우선 사용
         */

        if (
            category === 'castle' &&
            window.TopWarSkinExporter
                ?.getBuff
        ) {

            try {

                const result =
                    await window
                        .TopWarSkinExporter
                        .getBuff(
                            Number(
                                cfg.id
                            )
                        );

                if (result)
                    return result;

            } catch {}
        }


        const oldUse =
            controller
                .useBuffContent;

        const oldOwn =
            controller
                .ownBuffContent;


        const useTemp =
            createTempBuffNode();

        const ownTemp =
            createTempBuffNode();


        const saved = {

            _curHaloCfg:
                controller
                    ._curHaloCfg,

            _currId:
                controller
                    ._currId,

            _effectId:
                controller
                    ._effectId,

            _skinId:
                controller
                    ._skinId
        };


        try {

            controller
                .useBuffContent =
                useTemp.content;

            controller
                .ownBuffContent =
                ownTemp.content;


            if (
                category ===
                'castleHalo'
            ) {

                controller
                    ._curHaloCfg =
                    cfg;
            }


            if (
                category ===
                'cityEffect'
            ) {

                controller
                    ._effectId =
                    Number(
                        cfg.id
                    );
            }


            if (
                category ===
                'armyLine'
            ) {

                controller
                    ._currId =
                    Number(
                        cfg.id
                    );
            }


            /*
             * armyLine / cityEffect 계열은 cfg 파라미터를
             * 받는 구현도 있으므로 함수 length 확인
             */

            if (
                controller
                    .refreshBuffContent
                    .length >= 1
            ) {

                controller
                    .refreshBuffContent(
                        cfg
                    );

            } else {

                controller
                    .refreshBuffContent();
            }


            /*
             * Cocos destroy / instantiate 반영 한 프레임 대기
             */

            await new Promise(
                resolve =>
                    requestAnimationFrame(
                        () =>
                            requestAnimationFrame(
                                resolve
                            )
                    )
            );


            return {

                equipText:
                    readBuffChildren(
                        useTemp.content
                    ),

                ownText:
                    readBuffChildren(
                        ownTemp.content
                    )
            };


        } catch (e) {

            return null;


        } finally {

            controller
                .useBuffContent =
                oldUse;

            controller
                .ownBuffContent =
                oldOwn;


            controller
                ._curHaloCfg =
                saved._curHaloCfg;

            controller
                ._currId =
                saved._currId;

            controller
                ._effectId =
                saved._effectId;

            controller
                ._skinId =
                saved._skinId;


            try {
                useTemp.parent.destroy();
            } catch {}

            try {
                ownTemp.parent.destroy();
            } catch {}
        }
    }


    function mergeBuffData(
        raw,
        rendered
    ) {

        return raw.map(
            (item, index) => {

                const text =
                    rendered?.[
                        index
                    ] || '';


                const parts =
                    splitBuffText(
                        text
                    );


                return {

                    buffId:
                        item.buffId,

                    rawValue:
                        item.rawValue,

                    detail:
                        item.detail,

                    name:
                        parts.name,

                    value:
                        parts.value,

                    text,

                    raw:
                        item.raw
                };
            }
        );
    }


    /* ============================================================
     * 카테고리 스캔
     * ============================================================ */

    function scanCategory(key) {

        const cfg =
            CATEGORY[key];


        const root =
            findCategoryRoot(
                key
            );


        if (!root) {

            state.items[key] =
                [];

            warn(
                `${cfg.name}: 노드가 로드되지 않았습니다.`
            );

            return [];
        }


        const controller =
            findController(
                key,
                root
            );


        const result = [];
        const seen = new Set();


        walk(
            root,

            (
                node,
                path
            ) => {

                if (
                    !cfg.iconNames
                        .includes(
                            node.name
                        )
                ) {
                    return;
                }


                /*
                 * DetailNode 제외
                 */

                if (
                    /DetailNode/i
                        .test(path)
                ) {
                    return;
                }


                /*
                 * 실제 목록에서만
                 */

                if (
                    !/allTowerNode/i
                        .test(path)
                ) {
                    return;
                }


                const sf =
                    getSpriteFrame(
                        node
                    );

                if (!sf)
                    return;


                const id =
                    detectItemId(
                        key,
                        node,
                        sf
                    );


                const spriteInfo =
                    getSpriteInfo(
                        sf
                    );


                const unique =
                    `${id}|${spriteInfo.name}`;


                if (
                    seen.has(unique)
                ) {
                    return;
                }

                seen.add(unique);


                const itemRoot =
                    findItemRoot(
                        key,
                        node
                    );


                const rawConfig =
                    findConfig(
                        key,
                        id,
                        itemRoot,
                        controller
                    );


                const displayName =
                    detectDisplayName(
                        itemRoot,
                        id
                    );


                result.push({

                    category:
                        key,

                    categoryName:
                        cfg.name,

                    folder:
                        cfg.folder,

                    id:
                        String(id),

                    name:
                        displayName ||
                        rawConfig?.displayName ||
                        rawConfig?.name ||
                        '',

                    nameKey:
                        rawConfig?.name ||
                        '',

                    image:
                        `images/${String(id || spriteInfo.name)}.png`,

                    spriteFrame:
                        spriteInfo.name,

                    rotated:
                        spriteInfo.rotated,

                    textureUrl:
                        spriteInfo.textureUrl,

                    path,

                    sf,

                    node,

                    itemRoot,

                    controller,

                    config:
                        rawConfig
                });
            }
        );


        result.sort(
            (a, b) => {

                const an =
                    Number(a.id);

                const bn =
                    Number(b.id);


                if (
                    Number.isFinite(an) &&
                    Number.isFinite(bn)
                ) {

                    return (
                        bn - an
                    );
                }


                return (
                    String(a.id)
                        .localeCompare(
                            String(b.id)
                        )
                );
            }
        );


        state.items[key] =
            result;


        log(
            `${cfg.name}: ${result.length}개`
        );


        return result;
    }


    function scanAll() {

        for (
            const key
            of Object.keys(
                CATEGORY
            )
        ) {

            scanCategory(
                key
            );
        }


        render();
    }


    /* ============================================================
     * 최종 JSON Record 생성
     * ============================================================ */

    async function buildExportRecord(
        item
    ) {

        const cfg =
            item.config;


        const equipRaw =
            parseBuffString(
                cfg?.equip_buff
            );


        const ownRaw =
            parseBuffString(
                cfg?.own_buff
            );


        let localized =
            null;


        if (
            cfg &&
            (
                equipRaw.length ||
                ownRaw.length
            )
        ) {

            localized =
                await tryLocalizedBuffs(
                    item.category,
                    item.controller,
                    cfg
                );
        }


        const equipText =
            localized
                ?.equipText ||
            localized
                ?.equip ||
            [];


        const ownText =
            localized
                ?.ownText ||
            localized
                ?.own ||
            [];


        /*
         * 기존 exporter 결과 형식 대응
         */

        const normalizeRendered =
            value => {

                if (
                    !Array.isArray(value)
                ) {
                    return [];
                }

                return value.map(
                    x => {

                        if (
                            typeof x ===
                            'string'
                        ) {
                            return x;
                        }


                        return (
                            x?.text ||
                            [
                                x?.name,
                                x?.value
                            ]
                                .filter(Boolean)
                                .join(' ')
                        );
                    }
                );
            };


        return {

            id:
                /^\d+$/.test(
                    item.id
                )
                    ? Number(
                        item.id
                    )
                    : item.id,

            name:
                item.name,

            nameKey:
                item.nameKey,

            image:
                item.image,

            spriteFrame:
                item.spriteFrame,

            equipBuff:
                mergeBuffData(
                    equipRaw,
                    normalizeRendered(
                        equipText
                    )
                ),

            ownBuff:
                mergeBuffData(
                    ownRaw,
                    normalizeRendered(
                        ownText
                    )
                ),

            raw:
                cfg
                    ? sanitizeObject(
                        cfg
                    )
                    : null
        };
    }


    /* ============================================================
     * JSZip Loader
     * ============================================================ */

    async function ensureJSZip() {

        if (
            window.JSZip
        ) {
            return (
                window.JSZip
            );
        }


        setStatus(
            'JSZip 로드 중...'
        );


        await new Promise(
            (resolve, reject) => {

                const existing =
                    document.querySelector(
                        'script[data-tw-jszip]'
                    );


                if (existing) {

                    existing.addEventListener(
                        'load',
                        resolve,
                        {
                            once: true
                        }
                    );

                    existing.addEventListener(
                        'error',
                        reject,
                        {
                            once: true
                        }
                    );

                    return;
                }


                const script =
                    document.createElement(
                        'script'
                    );


                script.dataset.twJszip =
                    '1';


                script.src =
                    'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';


                script.onload =
                    resolve;

                script.onerror =
                    () =>
                        reject(
                            new Error(
                                'JSZip 로드 실패'
                            )
                        );


                document.head
                    .appendChild(
                        script
                    );
            }
        );


        if (
            !window.JSZip
        ) {
            throw new Error(
                'JSZip를 사용할 수 없습니다.'
            );
        }


        return window.JSZip;
    }


    /* ============================================================
     * ZIP 다운로드
     * ============================================================ */

    async function exportZip() {

        if (
            state.exporting
        ) {
            return;
        }


        state.exporting =
            true;


        const zipButton =
            root.querySelector(
                '[data-action="zip"]'
            );


        try {

            zipButton.disabled =
                true;


            /*
             * 최신 목록으로 다시 스캔
             */

            scanAll();


            const missing =
                Object
                    .keys(CATEGORY)
                    .filter(
                        key =>
                            !state.items[
                                key
                            ].length
                    );


            if (
                missing.length
            ) {

                const names =
                    missing.map(
                        key =>
                            CATEGORY[
                                key
                            ].name
                    );


                throw new Error(
                    `로드되지 않은 카테고리가 있습니다: ${names.join(', ')}\n게임에서 해당 탭을 한 번씩 연 뒤 다시 실행하세요.`
                );
            }


            const JSZip =
                await ensureJSZip();


            const zip =
                new JSZip();


            const rootFolder =
                zip.folder(
                    'apperance'
                );


            const index =
                {

                    version: 1,

                    generatedAt:
                        new Date()
                            .toISOString(),

                    categories: {}
                };


            let totalImages =
                0;


            let completedImages =
                0;


            for (
                const key
                of Object.keys(
                    CATEGORY
                )
            ) {

                const category =
                    CATEGORY[key];


                const items =
                    state.items[key];


                setStatus(
                    `${category.name} 데이터 처리 중...`
                );


                const categoryFolder =
                    rootFolder.folder(
                        category.folder
                    );


                const imageFolder =
                    categoryFolder.folder(
                        'images'
                    );


                const records =
                    [];


                for (
                    let i = 0;
                    i < items.length;
                    i++
                ) {

                    const item =
                        items[i];


                    setStatus(
                        `${category.name} 데이터 ${i + 1}/${items.length}`
                    );


                    try {

                        records.push(
                            await buildExportRecord(
                                item
                            )
                        );

                    } catch (e) {

                        console.warn(
                            '데이터 생성 실패',
                            item,
                            e
                        );


                        records.push({

                            id:
                                item.id,

                            name:
                                item.name,

                            nameKey:
                                item.nameKey,

                            image:
                                item.image,

                            spriteFrame:
                                item.spriteFrame,

                            equipBuff: [],

                            ownBuff: [],

                            raw:
                                item.config
                                    ? sanitizeObject(
                                        item.config
                                    )
                                    : null,

                            exportError:
                                String(
                                    e?.message ||
                                    e
                                )
                        });
                    }
                }


                categoryFolder.file(
                    'data.json',

                    JSON.stringify(
                        {
                            category:
                                category.folder,

                            name:
                                category.name,

                            generatedAt:
                                new Date()
                                    .toISOString(),

                            count:
                                records.length,

                            items:
                                records
                        },

                        null,
                        2
                    )
                );


                index.categories[
                    category.folder
                ] = {

                    name:
                        category.name,

                    data:
                        `${category.folder}/data.json`,

                    count:
                        records.length
                };


                totalImages +=
                    items.length;
            }


            /*
             * 이미지 생성
             */

            for (
                const key
                of Object.keys(
                    CATEGORY
                )
            ) {

                const category =
                    CATEGORY[key];

                const items =
                    state.items[key];


                const imageFolder =
                    rootFolder
                        .folder(
                            category.folder
                        )
                        .folder(
                            'images'
                        );


                for (
                    let i = 0;
                    i < items.length;
                    i++
                ) {

                    const item =
                        items[i];


                    completedImages++;


                    setStatus(
                        `이미지 ${completedImages}/${totalImages} - ${category.name} ${item.id}`
                    );


                    try {

                        const canvas =
                            await spriteFrameToCanvas(
                                item.sf
                            );


                        const blob =
                            await canvasToBlob(
                                canvas
                            );


                        const filename =
                            `${
                                String(
                                    item.id ||
                                    item.spriteFrame
                                )
                                    .replace(
                                        /[\\/:*?"<>|]/g,
                                        '_'
                                    )
                            }.png`;


                        imageFolder.file(
                            filename,
                            blob
                        );


                    } catch (e) {

                        console.warn(
                            '이미지 실패',
                            item,
                            e
                        );
                    }
                }
            }


            /*
             * index.json
             */

            index.total =
                Object.values(
                    state.items
                )
                    .reduce(
                        (
                            total,
                            items
                        ) =>
                            total +
                            items.length,
                        0
                    );


            rootFolder.file(
                'index.json',

                JSON.stringify(
                    index,
                    null,
                    2
                )
            );


            /*
             * ZIP 생성
             */

            setStatus(
                'ZIP 압축 중...'
            );


            const blob =
                await zip.generateAsync(

                    {
                        type: 'blob',

                        compression:
                            'DEFLATE',

                        compressionOptions: {
                            level: 6
                        }
                    },

                    meta => {

                        setStatus(
                            `ZIP 압축 ${meta.percent.toFixed(1)}%`
                        );
                    }
                );


            /*
             * 다운로드
             */

            const url =
                URL.createObjectURL(
                    blob
                );


            const a =
                document.createElement(
                    'a'
                );


            a.href =
                url;

            a.download =
                'apperance.zip';


            document.body
                .appendChild(a);

            a.click();

            a.remove();


            setTimeout(
                () =>
                    URL.revokeObjectURL(
                        url
                    ),
                5000
            );


            setStatus(
                `완료 - ${index.total}개 / apperance.zip`
            );


            log(
                'ZIP 생성 완료',
                index
            );


        } catch (e) {

            console.error(e);


            alert(
                `ZIP 생성 실패\n\n${e.message || e}`
            );


            setStatus(
                `오류: ${e.message || e}`
            );


        } finally {

            state.exporting =
                false;

            zipButton.disabled =
                false;
        }
    }


    /* ============================================================
     * 개별 PNG
     * ============================================================ */

    async function downloadSelectedPNG() {

        const item =
            state.selected;


        if (!item) {

            alert(
                '항목을 선택하세요.'
            );

            return;
        }


        try {

            const canvas =
                await spriteFrameToCanvas(
                    item.sf
                );


            const blob =
                await canvasToBlob(
                    canvas
                );


            const url =
                URL.createObjectURL(
                    blob
                );


            const a =
                document.createElement(
                    'a'
                );


            a.href =
                url;

            a.download =
                `${
                    item.id ||
                    item.spriteFrame
                }.png`;


            a.click();


            setTimeout(
                () =>
                    URL.revokeObjectURL(
                        url
                    ),
                3000
            );


        } catch (e) {

            alert(
                e.message
            );
        }
    }


    /* ============================================================
     * UI
     * ============================================================ */

    const root =
        document.createElement(
            'div'
        );


    root.id =
        'tw-appearance-manager';


    root.innerHTML = `

        <div class="tw-header">

            <div class="tw-title">
                TopWar Appearance Manager

                <span>
                    v${VERSION}
                </span>
            </div>

            <div class="tw-window-buttons">

                <button
                    title="전체 다시 읽기"
                    data-action="scan"
                >
                    ↻
                </button>

                <button
                    title="최소화"
                    data-action="minimize"
                >
                    −
                </button>

                <button
                    title="닫기"
                    data-action="close"
                >
                    ×
                </button>

            </div>

        </div>


        <div class="tw-body">


            <div class="tw-tabs">

                <button
                    class="active"
                    data-category="castle"
                >
                    기지 외관
                    <span data-count="castle">
                        0
                    </span>
                </button>


                <button
                    data-category="armyLine"
                >
                    대열 외관
                    <span data-count="armyLine">
                        0
                    </span>
                </button>


                <button
                    data-category="cityEffect"
                >
                    기지 효과
                    <span data-count="cityEffect">
                        0
                    </span>
                </button>


                <button
                    data-category="castleHalo"
                >
                    기지 오라
                    <span data-count="castleHalo">
                        0
                    </span>
                </button>

            </div>


            <div class="tw-toolbar">

                <input
                    class="tw-search"
                    placeholder="ID / 이름 / SpriteFrame 검색"
                >


                <button
                    data-action="scan-current"
                >
                    현재 탭 다시 읽기
                </button>

            </div>


            <div class="tw-main">

                <div class="tw-list">

                    <div class="tw-list-head">

                        <div>
                            IMG
                        </div>

                        <div>
                            ID
                        </div>

                        <div>
                            이름 / SpriteFrame
                        </div>

                    </div>


                    <div class="tw-list-body">
                    </div>

                </div>


                <div class="tw-detail">

                    <div class="tw-preview">
                        항목을 선택하세요.
                    </div>


                    <div class="tw-detail-info">
                    </div>

                </div>

            </div>


            <div class="tw-footer">

                <div class="tw-status">
                    준비
                </div>


                <div class="tw-footer-buttons">

                    <button
                        data-action="debug"
                    >
                        Console
                    </button>

                    <button
                        data-action="png"
                    >
                        PNG
                    </button>

                    <button
                        class="tw-zip"
                        data-action="zip"
                    >
                        전체 ZIP 다운로드
                    </button>

                </div>

            </div>

        </div>
    `;


    const style =
        document.createElement(
            'style'
        );


    style.id =
        'tw-appearance-manager-style';


    style.textContent = `

        #tw-appearance-manager {

            position: fixed;

            right: 18px;
            top: 18px;

            width: 850px;
            height: 650px;

            z-index: 2147483647;

            display: flex;
            flex-direction: column;

            overflow: hidden;

            color: #eef3fa;

            background: #111722;

            border: 1px solid #35445c;
            border-radius: 10px;

            box-shadow:
                0 12px 45px
                rgba(0,0,0,.6);

            font-family:
                Arial,
                "Noto Sans KR",
                sans-serif;

            font-size: 13px;
        }


        #tw-appearance-manager button {

            border:
                1px solid #40516d;

            border-radius: 5px;

            padding: 6px 10px;

            color: white;

            background: #25334a;

            cursor: pointer;
        }


        #tw-appearance-manager button:hover {

            background: #344967;
        }


        #tw-appearance-manager button:disabled {

            opacity: .5;
            cursor: default;
        }


        #tw-appearance-manager
        .tw-header {

            flex: 0 0 42px;

            display: flex;
            align-items: center;
            justify-content: space-between;

            padding:
                0 10px 0 14px;

            background:
                #1b2534;

            cursor: move;

            user-select: none;
        }


        #tw-appearance-manager
        .tw-title {

            font-weight: bold;
            font-size: 14px;
        }


        #tw-appearance-manager
        .tw-title span {

            margin-left: 5px;

            font-size: 10px;

            color: #899bb4;
        }


        #tw-appearance-manager
        .tw-window-buttons {

            display: flex;
            gap: 5px;
        }


        #tw-appearance-manager
        .tw-window-buttons button {

            width: 30px;
            height: 28px;

            padding: 0;
        }


        #tw-appearance-manager
        .tw-body {

            min-height: 0;

            flex: 1;

            display: flex;
            flex-direction: column;
        }


        #tw-appearance-manager
        .tw-tabs {

            display: grid;

            grid-template-columns:
                repeat(4,1fr);

            gap: 5px;

            padding: 8px;

            background: #151d29;
        }


        #tw-appearance-manager
        .tw-tabs button.active {

            background: #3e6fa8;

            border-color: #70a1da;
        }


        #tw-appearance-manager
        .tw-tabs span {

            opacity: .7;

            margin-left: 4px;
        }


        #tw-appearance-manager
        .tw-toolbar {

            display: flex;

            gap: 7px;

            padding:
                0 8px 8px;

            background: #151d29;
        }


        #tw-appearance-manager
        .tw-search {

            min-width: 0;

            flex: 1;

            padding: 7px 9px;

            color: white;

            background: #090e15;

            border:
                1px solid #34425b;

            border-radius: 5px;

            outline: none;
        }


        #tw-appearance-manager
        .tw-main {

            min-height: 0;

            flex: 1;

            display: grid;

            grid-template-columns:
                56% 44%;
        }


        #tw-appearance-manager
        .tw-list {

            min-width: 0;
            min-height: 0;

            display: flex;
            flex-direction: column;

            border-right:
                1px solid #303b4d;
        }


        #tw-appearance-manager
        .tw-list-head {

            display: grid;

            grid-template-columns:
                76px 85px 1fr;

            padding: 8px;

            font-weight: bold;

            background: #202b3b;
        }


        #tw-appearance-manager
        .tw-list-body {

            min-height: 0;
            flex: 1;

            overflow: auto;
        }


        #tw-appearance-manager
        .tw-row {

            min-height: 60px;

            display: grid;

            grid-template-columns:
                76px 85px 1fr;

            align-items: center;

            padding: 4px 8px;

            border-bottom:
                1px solid #263143;

            cursor: pointer;
        }


        #tw-appearance-manager
        .tw-row:hover {

            background: #202c3e;
        }


        #tw-appearance-manager
        .tw-row.selected {

            background: #284970;
        }


        #tw-appearance-manager
        .tw-thumb {

            width: 64px;
            height: 50px;

            object-fit: contain;

            border-radius: 4px;

            background:
                rgba(0,0,0,.25);
        }


        #tw-appearance-manager
        .tw-item-name {

            font-weight: bold;

            margin-bottom: 3px;
        }


        #tw-appearance-manager
        .tw-sf {

            word-break: break-all;

            font-size: 11px;

            color: #9db4d5;
        }


        #tw-appearance-manager
        .tw-detail {

            min-width: 0;

            overflow: auto;

            padding: 12px;
        }


        #tw-appearance-manager
        .tw-preview {

            min-height: 240px;

            display: flex;
            justify-content: center;
            align-items: center;

            overflow: hidden;

            background: #080d13;

            border:
                1px solid #303c4e;

            border-radius: 7px;
        }


        #tw-appearance-manager
        .tw-preview img {

            max-width: 100%;
            max-height: 340px;

            object-fit: contain;
        }


        #tw-appearance-manager
        .tw-detail-info {

            margin-top: 12px;

            line-height: 1.65;

            word-break: break-all;
        }


        #tw-appearance-manager
        .tw-key {

            color: #8296b4;
        }


        #tw-appearance-manager
        .tw-footer {

            min-height: 46px;

            display: flex;

            align-items: center;
            justify-content: space-between;

            gap: 10px;

            padding: 6px 9px;

            background: #151d29;

            border-top:
                1px solid #303b4d;
        }


        #tw-appearance-manager
        .tw-status {

            min-width: 0;

            overflow: hidden;

            white-space: nowrap;

            text-overflow: ellipsis;

            color: #a2b4cb;
        }


        #tw-appearance-manager
        .tw-footer-buttons {

            flex: 0 0 auto;

            display: flex;

            gap: 5px;
        }


        #tw-appearance-manager
        .tw-zip {

            background: #2f7c50;

            border-color: #4ca873;
        }


        #tw-appearance-manager
        .tw-zip:hover {

            background: #39945f;
        }


        #tw-appearance-manager.tw-minimized {

            width: 330px;
            height: 42px;
        }


        #tw-appearance-manager.tw-minimized
        .tw-body {

            display: none;
        }
    `;


    document.head
        .appendChild(
            style
        );


    document.body
        .appendChild(
            root
        );


    /* ============================================================
     * DOM
     * ============================================================ */

    const $ =
        selector =>
            root.querySelector(
                selector
            );


    const $$ =
        selector =>
            [
                ...root.querySelectorAll(
                    selector
                )
            ];


    const listBody =
        $('.tw-list-body');

    const preview =
        $('.tw-preview');

    const detailInfo =
        $('.tw-detail-info');

    const searchInput =
        $('.tw-search');

    const statusElement =
        $('.tw-status');


    function setStatus(text) {

        statusElement.textContent =
            text;
    }


    function updateCounts() {

        for (
            const key
            of Object.keys(
                CATEGORY
            )
        ) {

            const count =
                root.querySelector(
                    `[data-count="${key}"]`
                );


            if (count) {

                count.textContent =
                    state.items[
                        key
                    ].length;
            }
        }
    }


    /* ============================================================
     * 렌더링
     * ============================================================ */

    async function selectItem(
        item,
        row
    ) {

        state.selected =
            item;


        $$('.tw-row')
            .forEach(
                x =>
                    x.classList
                        .remove(
                            'selected'
                        )
            );


        row?.classList.add(
            'selected'
        );


        preview.textContent =
            '이미지 생성 중...';


        const raw =
            item.config;


        detailInfo.innerHTML = `

            <div>
                <span class="tw-key">
                    분류
                </span>
                : ${item.categoryName}
            </div>

            <div>
                <span class="tw-key">
                    ID
                </span>
                : ${item.id || '-'}
            </div>

            <div>
                <span class="tw-key">
                    이름
                </span>
                : ${item.name || '-'}
            </div>

            <div>
                <span class="tw-key">
                    nameKey
                </span>
                : ${item.nameKey || '-'}
            </div>

            <div>
                <span class="tw-key">
                    SpriteFrame
                </span>
                : ${item.spriteFrame}
            </div>

            <div>
                <span class="tw-key">
                    rotated
                </span>
                : ${item.rotated}
            </div>

            <hr>

            <div>
                <span class="tw-key">
                    equip_buff
                </span>
                :
                ${raw?.equip_buff || '-'}
            </div>

            <div>
                <span class="tw-key">
                    own_buff
                </span>
                :
                ${raw?.own_buff || '-'}
            </div>

            <div>
                <span class="tw-key">
                    config
                </span>
                :
                ${raw ? 'FOUND' : 'NOT FOUND'}
            </div>
        `;


        try {

            const canvas =
                await spriteFrameToCanvas(
                    item.sf
                );


            const img =
                document.createElement(
                    'img'
                );


            img.src =
                canvas.toDataURL(
                    'image/png'
                );


            preview.innerHTML =
                '';

            preview.appendChild(
                img
            );


        } catch (e) {

            preview.textContent =
                `이미지 실패: ${e.message}`;
        }
    }


    async function render() {

        updateCounts();


        const category =
            state.category;


        const keyword =
            String(
                searchInput.value ||
                ''
            )
                .trim()
                .toLowerCase();


        const items =
            state.items[
                category
            ]
                .filter(
                    item => {

                        if (!keyword)
                            return true;


                        return (
                            String(
                                item.id
                            )
                                .toLowerCase()
                                .includes(
                                    keyword
                                ) ||

                            String(
                                item.name
                            )
                                .toLowerCase()
                                .includes(
                                    keyword
                                ) ||

                            String(
                                item.spriteFrame
                            )
                                .toLowerCase()
                                .includes(
                                    keyword
                                )
                        );
                    }
                );


        listBody.innerHTML =
            '';


        for (
            const item
            of items
        ) {

            const row =
                document.createElement(
                    'div'
                );

            row.className =
                'tw-row';


            const imageCell =
                document.createElement(
                    'div'
                );


            const img =
                document.createElement(
                    'img'
                );

            img.className =
                'tw-thumb';


            imageCell.appendChild(
                img
            );


            const idCell =
                document.createElement(
                    'div'
                );

            idCell.textContent =
                item.id || '-';


            const textCell =
                document.createElement(
                    'div'
                );


            textCell.innerHTML = `

                <div class="tw-item-name">
                    ${
                        item.name ||
                        '(이름 미확인)'
                    }
                </div>

                <div class="tw-sf">
                    ${item.spriteFrame}
                </div>
            `;


            row.append(
                imageCell,
                idCell,
                textCell
            );


            row.onclick =
                () =>
                    selectItem(
                        item,
                        row
                    );


            listBody.appendChild(
                row
            );


            spriteFrameToCanvas(
                item.sf
            )
                .then(
                    canvas => {

                        img.src =
                            canvas.toDataURL(
                                'image/png'
                            );
                    }
                )
                .catch(() => {});
        }


        setStatus(
            `${CATEGORY[category].name} ${items.length}개`
        );
    }


    function changeCategory(
        key
    ) {

        state.category =
            key;


        $$('.tw-tabs button')
            .forEach(
                btn => {

                    btn.classList.toggle(
                        'active',
                        btn.dataset
                            .category === key
                    );
                }
            );


        if (
            !state.items[
                key
            ].length
        ) {

            scanCategory(
                key
            );
        }


        render();
    }


    /* ============================================================
     * UI 이벤트
     * ============================================================ */

    root.addEventListener(
        'click',
        event => {

            const button =
                event.target.closest(
                    'button'
                );


            if (!button)
                return;


            if (
                button.dataset
                    .category
            ) {

                changeCategory(
                    button.dataset
                        .category
                );

                return;
            }


            switch (
                button.dataset.action
            ) {

                case 'scan':

                    scanAll();

                    break;


                case 'scan-current':

                    scanCategory(
                        state.category
                    );

                    render();

                    break;


                case 'minimize':

                    state.minimized =
                        !state.minimized;


                    root.classList.toggle(
                        'tw-minimized',
                        state.minimized
                    );


                    button.textContent =
                        state.minimized
                            ? '+'
                            : '−';

                    break;


                case 'close':

                    manager.destroy();

                    break;


                case 'debug':

                    console.log(
                        'Selected:',
                        state.selected
                    );

                    console.log(
                        'Config:',
                        state.selected
                            ?.config
                    );

                    break;


                case 'png':

                    downloadSelectedPNG();

                    break;


                case 'zip':

                    exportZip();

                    break;
            }
        }
    );


    searchInput.addEventListener(
        'input',
        render
    );


    /* ============================================================
     * Drag
     * ============================================================ */

    const header =
        $('.tw-header');


    let dragging =
        false;

    let offsetX =
        0;

    let offsetY =
        0;


    header.addEventListener(
        'mousedown',
        e => {

            if (
                e.target.closest(
                    'button'
                )
            ) {
                return;
            }


            const rect =
                root
                    .getBoundingClientRect();


            dragging =
                true;


            offsetX =
                e.clientX -
                rect.left;

            offsetY =
                e.clientY -
                rect.top;


            root.style.right =
                'auto';
        }
    );


    document.addEventListener(
        'mousemove',
        e => {

            if (!dragging)
                return;


            root.style.left =
                `${Math.max(
                    0,
                    e.clientX -
                    offsetX
                )}px`;


            root.style.top =
                `${Math.max(
                    0,
                    e.clientY -
                    offsetY
                )}px`;
        }
    );


    document.addEventListener(
        'mouseup',
        () => {

            dragging =
                false;
        }
    );


    /* ============================================================
     * 공개 API
     * ============================================================ */

    const manager = {

        version:
            VERSION,

        state,

        scan:
            scanAll,

        scanCategory,

        exportZip,

        async getData(
            category
        ) {

            const items =
                state.items[
                    category
                ] || [];


            const result =
                [];


            for (
                const item
                of items
            ) {

                result.push(
                    await buildExportRecord(
                        item
                    )
                );
            }


            return result;
        },


        minimize() {

            state.minimized =
                true;

            root.classList.add(
                'tw-minimized'
            );
        },


        restore() {

            state.minimized =
                false;

            root.classList.remove(
                'tw-minimized'
            );
        },


        destroy() {

            root.remove();

            document
                .getElementById(
                    'tw-appearance-manager-style'
                )
                ?.remove();


            delete window
                .TopWarAppearanceManager;
        }
    };


    window.TopWarAppearanceManager =
        manager;


    /* ============================================================
     * 시작
     * ============================================================ */

    scanAll();


    log(
        `v${VERSION} 설치 완료`
    );


    console.log(`
TopWarAppearanceManager 사용 가능

TopWarAppearanceManager.scan()

TopWarAppearanceManager.exportZip()

TopWarAppearanceManager.getData("castle")
TopWarAppearanceManager.getData("armyLine")
TopWarAppearanceManager.getData("cityEffect")
TopWarAppearanceManager.getData("castleHalo")
    `);

})();
