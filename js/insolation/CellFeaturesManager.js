/**
 * CellFeaturesManager.js
 * Управление окнами и балконами в ячейках инсоляционной сетки
 * 
 * Фичи:
 * - Хранение окон и балконов для каждой ячейки
 * - Создание 3D геометрии окон (заглубление) и балконов (выступ)
 * - Расчётные точки в центре окна
 */

class CellFeaturesManager {
    constructor(scene) {
        this.scene = scene;
        
        console.log('[CellFeaturesManager] Constructor, scene:', !!scene, scene?.type);
        
        // Хранилище: cellKey -> { window: {...} | null, balcony: {...} | null }
        this.cellFeatures = new Map();
        
        // Группа для 3D объектов
        this.featuresGroup = new THREE.Group();
        this.featuresGroup.name = 'cellFeatures';
        this.scene.add(this.featuresGroup);
        
        console.log('[CellFeaturesManager] Added featuresGroup to scene');
        
        // Параметры по умолчанию
        this.defaults = {
            windowWidth: 1.5,      // м
            windowHeight: 1.5,    // м
            windowDepth: 0.25,    // м (заглубление)
            windowOffsetZ: 0,     // смещение по Z от центра ячейки
            
            balconyDepth: 1.2,    // м (выступ)
            balconyHeight: 0.2,   // м (толщина плиты)
            balconyRailingHeight: 1.0,  // м
            balconyRailingWidth: 0.05   // м
        };
        
        // Материалы
        this.materials = {
            windowGlass: new THREE.MeshPhysicalMaterial({
                color: 0x88ccff,
                transparent: true,
                opacity: 0.4,
                roughness: 0.1,
                metalness: 0.0,
                side: THREE.DoubleSide
            }),
            windowFrame: new THREE.MeshStandardMaterial({
                color: 0xffffff,
                roughness: 0.3,
                metalness: 0.1
            }),
            windowRecess: new THREE.MeshStandardMaterial({
                color: 0x404050,
                roughness: 0.8,
                metalness: 0.0,
                side: THREE.DoubleSide  // Для корректного raycast
            }),
            balconySlab: new THREE.MeshStandardMaterial({
                color: 0x808080,
                roughness: 0.7,
                metalness: 0.1,
                side: THREE.DoubleSide  // Для корректного raycast
            }),
            balconyRailing: new THREE.MeshStandardMaterial({
                color: 0x606060,
                roughness: 0.5,
                metalness: 0.3
            })
        };
        
        // Кэш мешей для каждой ячейки
        this.meshCache = new Map();  // cellKey -> { windowMesh, balconyMesh }
    }
    
    /**
     * Получить или создать features для ячейки
     */
    getFeatures(cellKey) {
        if (!this.cellFeatures.has(cellKey)) {
            this.cellFeatures.set(cellKey, { window: null, balcony: null });
        }
        return this.cellFeatures.get(cellKey);
    }
    
    /**
     * Проверить есть ли окно в ячейке
     */
    hasWindow(cellKey) {
        const f = this.cellFeatures.get(cellKey);
        return f && f.window !== null;
    }
    
    /**
     * Проверить есть ли балкон в ячейке
     */
    hasBalcony(cellKey) {
        const f = this.cellFeatures.get(cellKey);
        return f && f.balcony !== null;
    }
    
    /**
     * Добавить окно в ячейку
     * @param {Object} cell - данные ячейки из GridEditMode
     * @param {Object} options - опции окна
     */
    addWindow(cell, options = {}) {
        const cellKey = cell.key;
        const features = this.getFeatures(cellKey);
        
        // Проверка данных ячейки
        if (!cell.cellWidth || !cell.cellHeight || cell.cellWidth < 0.1 || cell.cellHeight < 0.1) {
            console.warn('[CellFeaturesManager] addWindow: invalid cell dimensions', cell.key, cell.cellWidth, cell.cellHeight);
            return null;
        }
        
        // Размеры окна (не больше ячейки)
        const maxWidth = cell.cellWidth * 0.9;
        const maxHeight = cell.cellHeight * 0.9;
        
        features.window = {
            width: Math.min(options.width || this.defaults.windowWidth, maxWidth),
            height: Math.min(options.height || this.defaults.windowHeight, maxHeight),
            depth: options.depth || this.defaults.windowDepth,
            offsetZ: options.offsetZ || this.defaults.windowOffsetZ
        };
        
        this._updateCellMesh(cell);
        return features.window;
    }
    
    /**
     * Добавить балкон в ячейку
     * @param {Object} cell - данные ячейки
     * @param {Object} options - опции балкона
     */
    addBalcony(cell, options = {}) {
        const cellKey = cell.key;
        const features = this.getFeatures(cellKey);
        
        features.balcony = {
            depth: options.depth || this.defaults.balconyDepth,
            height: options.height || this.defaults.balconyHeight,
            railingHeight: options.railingHeight || this.defaults.balconyRailingHeight,
            railingWidth: options.railingWidth || this.defaults.balconyRailingWidth
        };
        
        this._updateCellMesh(cell);
        return features.balcony;
    }
    
    /**
     * Добавить окно и балкон вместе
     */
    addWindowAndBalcony(cell, windowOptions = {}, balconyOptions = {}) {
        this.addWindow(cell, windowOptions);
        this.addBalcony(cell, balconyOptions);
    }
    
    /**
     * Установить окна во все ячейки
     * @param {Array} cells - массив ячеек из GridEditMode или InsolationGrid
     * @param {Object} options - опции окна
     */
    setAllWindows(cells, options = {}) {
        console.log('[CellFeaturesManager] setAllWindows called with', cells.length, 'cells');
        let count = 0;
        let errors = 0;
        for (const cell of cells) {
            const result = this.addWindow(cell, options);
            if (result) {
                count++;
            } else {
                errors++;
            }
        }
        console.log(`[CellFeaturesManager] Установлено ${count} окон, ошибок: ${errors}`);
        console.log('[CellFeaturesManager] featuresGroup has', this.featuresGroup.children.length, 'children');
        return count;
    }
    
    /**
     * Установить балконы во все ячейки
     * @param {Array} cells - массив ячеек
     * @param {Object} options - опции балкона
     */
    setAllBalconies(cells, options = {}) {
        let count = 0;
        for (const cell of cells) {
            this.addBalcony(cell, options);
            count++;
        }
        console.log(`[CellFeaturesManager] Установлено ${count} балконов`);
        return count;
    }
    
    /**
     * Установить окна и балконы во все ячейки
     * @param {Array} cells - массив ячеек
     * @param {Object} windowOptions - опции окна
     * @param {Object} balconyOptions - опции балкона
     */
    setAllWindowsAndBalconies(cells, windowOptions = {}, balconyOptions = {}) {
        let count = 0;
        for (const cell of cells) {
            this.addWindowAndBalcony(cell, windowOptions, balconyOptions);
            count++;
        }
        console.log(`[CellFeaturesManager] Установлено ${count} окон+балконов`);
        return count;
    }
    
    /**
     * Удалить все окна
     */
    removeAllWindows() {
        let count = 0;
        for (const [cellKey, features] of this.cellFeatures) {
            if (features.window) {
                features.window = null;
                this._removeCellMesh(cellKey, 'window');
                count++;
            }
        }
        console.log(`[CellFeaturesManager] Удалено ${count} окон`);
        return count;
    }
    
    /**
     * Удалить все балконы
     */
    removeAllBalconies() {
        let count = 0;
        for (const [cellKey, features] of this.cellFeatures) {
            if (features.balcony) {
                features.balcony = null;
                this._removeCellMesh(cellKey, 'balcony');
                count++;
            }
        }
        console.log(`[CellFeaturesManager] Удалено ${count} балконов`);
        return count;
    }
    
    /**
     * Удалить окно из ячейки
     */
    removeWindow(cellKey) {
        const features = this.cellFeatures.get(cellKey);
        if (features) {
            features.window = null;
            this._removeCellMesh(cellKey, 'window');
        }
    }
    
    /**
     * Удалить балкон из ячейки
     */
    removeBalcony(cellKey) {
        const features = this.cellFeatures.get(cellKey);
        if (features) {
            features.balcony = null;
            this._removeCellMesh(cellKey, 'balcony');
        }
    }
    
    /**
     * Удалить всё из ячейки
     */
    removeAll(cellKey) {
        this.removeWindow(cellKey);
        this.removeBalcony(cellKey);
        this.cellFeatures.delete(cellKey);
    }
    
    /**
     * Обновить глубину окна для выбранных ячеек
     */
    updateWindowDepth(cellKeys, depth) {
        for (const cellKey of cellKeys) {
            const features = this.cellFeatures.get(cellKey);
            if (features && features.window) {
                features.window.depth = depth;
            }
        }
        // Перестроить меши
        // (нужен доступ к cells для rebuild)
    }
    
    /**
     * Обновить глубину балкона для выбранных ячеек
     */
    updateBalconyDepth(cellKeys, depth) {
        for (const cellKey of cellKeys) {
            const features = this.cellFeatures.get(cellKey);
            if (features && features.balcony) {
                features.balcony.depth = depth;
            }
        }
    }
    
    /**
     * Получить позицию расчётной точки для ячейки с окном
     * Точка в центре окна, близко к плоскости стекла
     */
    getCalculationPointPosition(cell) {
        const features = this.cellFeatures.get(cell.key);
        
        if (features && features.window) {
            // Точка в центре окна, смещена на глубину окна внутрь
            const win = features.window;
            const offsetFromWall = win.depth * 0.9;  // почти у стекла
            
            return {
                x: cell.cx - cell.nx * offsetFromWall,
                y: cell.cy - cell.ny * offsetFromWall,
                z: cell.cz + (win.offsetZ || 0),
                normalX: cell.nx,
                normalY: cell.ny
            };
        }
        
        // Без окна - стандартная позиция
        return {
            x: cell.cx,
            y: cell.cy,
            z: cell.cz,
            normalX: cell.nx,
            normalY: cell.ny
        };
    }
    
    /**
     * Создать/обновить 3D меш для ячейки
     */
    _updateCellMesh(cell) {
        const cellKey = cell.key;
        const features = this.cellFeatures.get(cellKey);
        if (!features) {
            console.log('[CellFeaturesManager] _updateCellMesh: no features for', cellKey);
            return;
        }
        
        console.log('[CellFeaturesManager] _updateCellMesh:', cellKey, 
            'window:', !!features.window, 'balcony:', !!features.balcony,
            'cell.cx:', cell.cx?.toFixed(2), 'cell.cy:', cell.cy?.toFixed(2), 'cell.cz:', cell.cz?.toFixed(2));
        
        // Удаляем старые меши
        this._clearCellMeshes(cellKey);
        
        const meshes = { windowMesh: null, balconyMesh: null };
        
        // Создаём балкон (сначала, он ниже окна визуально)
        if (features.balcony) {
            meshes.balconyMesh = this._createBalconyMesh(cell, features.balcony);
            console.log('[CellFeaturesManager] Created balcony mesh:', !!meshes.balconyMesh);
            if (meshes.balconyMesh) {
                this.featuresGroup.add(meshes.balconyMesh);
            }
        }
        
        // Создаём окно
        if (features.window) {
            meshes.windowMesh = this._createWindowMesh(cell, features.window);
            console.log('[CellFeaturesManager] Created window mesh:', !!meshes.windowMesh);
            if (meshes.windowMesh) {
                this.featuresGroup.add(meshes.windowMesh);
            }
        }
        
        this.meshCache.set(cellKey, meshes);
        console.log('[CellFeaturesManager] featuresGroup children:', this.featuresGroup.children.length);
    }
    
    /**
     * Создать меш окна (только откосы и рама, без стекла)
     * Откосы выступают наружу от стены
     */
    _createWindowMesh(cell, windowData) {
        const group = new THREE.Group();
        group.name = `window-${cell.key}`;
        
        const { width, height, depth } = windowData;
        const hw = width / 2;
        const hh = height / 2;
        const recessThickness = 0.08;  // Толщина откоса 8 см
        
        // Центр ячейки в мировых координатах
        const cx = cell.cx;
        const cy = cell.cy;
        const cz = cell.cz + (windowData.offsetZ || 0);
        
        // Проверка на NaN
        if (isNaN(cx) || isNaN(cy) || isNaN(cz)) {
            console.error('[CellFeaturesManager] _createWindowMesh: NaN coordinates!', cell);
            return null;
        }
        
        // Нормаль (наружу) и касательная
        const nx = cell.nx;
        const ny = cell.ny;
        const tx = cell.faceDirX;
        const ty = cell.faceDirY;
        
        if (isNaN(nx) || isNaN(ny) || isNaN(tx) || isNaN(ty)) {
            console.error('[CellFeaturesManager] _createWindowMesh: NaN normals!', cell);
            return null;
        }
        
        // Стекло УДАЛЕНО - оставляем только откосы
        // Точка расчёта остаётся на уровне стены
        
        // Создаём 4 плоских откоса (только внешняя грань)
        // Нижний откос - горизонтальная плоскость
        const bottomRecess = this._createRecessPlane(
            width, depth, recessThickness,
            cx, cy, cz - hh + recessThickness / 2,
            nx, ny, tx, ty,
            'bottom'
        );
        group.add(bottomRecess);
        
        // Верхний откос - горизонтальная плоскость
        const topRecess = this._createRecessPlane(
            width, depth, recessThickness,
            cx, cy, cz + hh - recessThickness / 2,
            nx, ny, tx, ty,
            'top'
        );
        group.add(topRecess);
        
        // Левый откос - вертикальная плоскость
        const leftRecess = this._createRecessPlane(
            recessThickness, depth, height - recessThickness * 2,
            cx - tx * (hw - recessThickness / 2),
            cy - ty * (hw - recessThickness / 2),
            cz,
            nx, ny, tx, ty,
            'left'
        );
        group.add(leftRecess);
        
        // Правый откос - вертикальная плоскость
        const rightRecess = this._createRecessPlane(
            recessThickness, depth, height - recessThickness * 2,
            cx + tx * (hw - recessThickness / 2),
            cy + ty * (hw - recessThickness / 2),
            cz,
            nx, ny, tx, ty,
            'right'
        );
        group.add(rightRecess);
        
        // Рама окна (внешний контур)
        const frameOffset = depth;
        const framePoints = [
            new THREE.Vector3(cx - tx * hw + nx * frameOffset, cy - ty * hw + ny * frameOffset, cz - hh),
            new THREE.Vector3(cx + tx * hw + nx * frameOffset, cy + ty * hw + ny * frameOffset, cz - hh),
            new THREE.Vector3(cx + tx * hw + nx * frameOffset, cy + ty * hw + ny * frameOffset, cz + hh),
            new THREE.Vector3(cx - tx * hw + nx * frameOffset, cy - ty * hw + ny * frameOffset, cz + hh),
            new THREE.Vector3(cx - tx * hw + nx * frameOffset, cy - ty * hw + ny * frameOffset, cz - hh)
        ];
        const frameGeom = new THREE.BufferGeometry().setFromPoints(framePoints);
        const frameLine = new THREE.Line(
            frameGeom, 
            new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 })
        );
        group.add(frameLine);
        
        // Помечаем группу для raycast
        group.userData.isWindow = true;
        group.userData.cellKey = cell.key;
        
        return group;
    }
    
    /**
     * Создать плоский откос (только внешняя грань)
     */
    _createRecessPlane(planeWidth, planeDepth, planeHeight, cx, cy, cz, nx, ny, tx, ty, side) {
        // Создаём геометрию откоса как BufferGeometry с 4 вершинами
        const geometry = new THREE.BufferGeometry();
        
        // Вычисляем 4 угла откоса в зависимости от стороны
        let vertices;
        
        if (side === 'bottom' || side === 'top') {
            // Горизонтальный откос (width x depth)
            const hw = planeWidth / 2;
            const z = cz;
            
            // 4 угла: от стены (0) до внешнего края (depth)
            const v0 = [cx - tx * hw, cy - ty * hw, z];  // inner left
            const v1 = [cx + tx * hw, cy + ty * hw, z];  // inner right
            const v2 = [cx + tx * hw + nx * planeDepth, cy + ty * hw + ny * planeDepth, z];  // outer right
            const v3 = [cx - tx * hw + nx * planeDepth, cy - ty * hw + ny * planeDepth, z];  // outer left
            
            vertices = new Float32Array([
                ...v0, ...v1, ...v2,  // triangle 1
                ...v0, ...v2, ...v3   // triangle 2
            ]);
        } else {
            // Вертикальный откос (depth x height)
            const hh = planeHeight / 2;
            
            // 4 угла: от стены (0) до внешнего края (depth)
            const v0 = [cx, cy, cz - hh];  // inner bottom
            const v1 = [cx, cy, cz + hh];  // inner top
            const v2 = [cx + nx * planeDepth, cy + ny * planeDepth, cz + hh];  // outer top
            const v3 = [cx + nx * planeDepth, cy + ny * planeDepth, cz - hh];  // outer bottom
            
            vertices = new Float32Array([
                ...v0, ...v1, ...v2,  // triangle 1
                ...v0, ...v2, ...v3   // triangle 2
            ]);
        }
        
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geometry.computeVertexNormals();
        
        const mesh = new THREE.Mesh(geometry, this.materials.windowRecess);
        mesh.userData.isWindowRecess = true;
        mesh.userData.recessSide = side;
        
        return mesh;
    }
    
    /**
     * Создать меш балкона (только плита)
     */
    _createBalconyMesh(cell, balconyData) {
        const group = new THREE.Group();
        group.name = `balcony-${cell.key}`;
        
        const { depth, height } = balconyData;
        
        // Нижняя Z координата ячейки
        const z0 = cell.z1;
        
        // Ширина балкона = ширина ячейки
        const balconyWidth = cell.cellWidth;
        
        // Центр нижней границы ячейки
        const baseX = cell.bottomCenterX;
        const baseY = cell.bottomCenterY;
        
        // Нормаль фасада (наружу)
        const nx = cell.nx;
        const ny = cell.ny;
        
        // Плита балкона
        const slabGeom = new THREE.BoxGeometry(balconyWidth, depth, height);
        const slabMesh = new THREE.Mesh(slabGeom, this.materials.balconySlab);
        
        // Позиция плиты: центр выдвинут на depth/2 наружу
        slabMesh.position.set(
            baseX + nx * (depth / 2),
            baseY + ny * (depth / 2),
            z0 + height / 2
        );
        
        // Поворот по нормали фасада
        slabMesh.rotation.z = Math.atan2(ny, nx) - Math.PI / 2;
        
        // Помечаем для raycast
        slabMesh.userData.isBalcony = true;
        slabMesh.userData.cellKey = cell.key;
        
        group.add(slabMesh);
        
        return group;
    }
    
    /**
     * Удалить меши для ячейки
     */
    _clearCellMeshes(cellKey) {
        const cached = this.meshCache.get(cellKey);
        if (cached) {
            if (cached.windowMesh) {
                this.featuresGroup.remove(cached.windowMesh);
                this._disposeMesh(cached.windowMesh);
            }
            if (cached.balconyMesh) {
                this.featuresGroup.remove(cached.balconyMesh);
                this._disposeMesh(cached.balconyMesh);
            }
            this.meshCache.delete(cellKey);
        }
    }
    
    /**
     * Удалить конкретный тип меша
     */
    _removeCellMesh(cellKey, type) {
        const cached = this.meshCache.get(cellKey);
        if (cached) {
            const key = type === 'window' ? 'windowMesh' : 'balconyMesh';
            if (cached[key]) {
                this.featuresGroup.remove(cached[key]);
                this._disposeMesh(cached[key]);
                cached[key] = null;
            }
        }
    }
    
    /**
     * Освободить ресурсы меша
     */
    _disposeMesh(mesh) {
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.children) {
            for (const child of mesh.children) {
                this._disposeMesh(child);
            }
        }
    }
    
    /**
     * Перестроить все меши (после изменения сетки)
     */
    rebuildAllMeshes(cells) {
        // Очищаем все меши
        while (this.featuresGroup.children.length > 0) {
            const child = this.featuresGroup.children[0];
            this.featuresGroup.remove(child);
            this._disposeMesh(child);
        }
        this.meshCache.clear();
        
        // Перестраиваем
        for (const cell of cells) {
            const features = this.cellFeatures.get(cell.key);
            if (features && (features.window || features.balcony)) {
                this._updateCellMesh(cell);
            }
        }
    }
    
    /**
     * Очистить всё
     */
    clear() {
        while (this.featuresGroup.children.length > 0) {
            const child = this.featuresGroup.children[0];
            this.featuresGroup.remove(child);
            this._disposeMesh(child);
        }
        this.meshCache.clear();
        this.cellFeatures.clear();
    }
    
    /**
     * Удалить группу из сцены
     */
    dispose() {
        this.clear();
        this.scene.remove(this.featuresGroup);
        
        // Освобождаем материалы
        for (const mat of Object.values(this.materials)) {
            mat.dispose();
        }
    }
    
    /**
     * Экспорт данных для сохранения
     */
    toJSON() {
        const data = {};
        for (const [key, features] of this.cellFeatures) {
            if (features.window || features.balcony) {
                data[key] = features;
            }
        }
        return data;
    }
    
    /**
     * Импорт данных
     */
    fromJSON(data, cells) {
        this.clear();
        
        for (const [key, features] of Object.entries(data)) {
            this.cellFeatures.set(key, features);
        }
        
        this.rebuildAllMeshes(cells);
    }
    
    /**
     * Привязать меши окон/балконов к зданию
     * Создаёт постоянные меши как children mesh здания
     * @param {THREE.Mesh} buildingMesh - меш здания
     * @param {Array} cells - массив ячеек с локальными данными
     */
    attachToBuilding(buildingMesh, cells) {
        if (!buildingMesh) return;
        
        // Удаляем временные меши из сцены (но НЕ данные cellFeatures!)
        while (this.featuresGroup.children.length > 0) {
            const child = this.featuresGroup.children[0];
            this.featuresGroup.remove(child);
            this._disposeMesh(child);
        }
        this.meshCache.clear();
        
        // Удаляем старую группу features у здания если есть
        const oldGroup = buildingMesh.children.find(c => c.name === 'buildingFeatures');
        if (oldGroup) {
            buildingMesh.remove(oldGroup);
            this._disposeMesh(oldGroup);
        }
        
        // Если нет features - выходим
        if (this.cellFeatures.size === 0) {
            console.log('[CellFeaturesManager] Нет features для сохранения');
            return;
        }
        
        // Создаём новую группу для features
        const featuresGroup = new THREE.Group();
        featuresGroup.name = 'buildingFeatures';
        
        const pos = buildingMesh.position;
        const rot = buildingMesh.rotation.z || 0;
        const cos = Math.cos(-rot);  // обратное вращение для перехода в локальные
        const sin = Math.sin(-rot);
        
        // Создаём меши в локальных координатах
        for (const cell of cells) {
            const features = this.cellFeatures.get(cell.key);
            if (!features) continue;
            
            if (features.window) {
                const windowMesh = this._createWindowMeshLocal(cell, features.window, pos, cos, sin);
                if (windowMesh) featuresGroup.add(windowMesh);
            }
            
            if (features.balcony) {
                const balconyMesh = this._createBalconyMeshLocal(cell, features.balcony, pos, cos, sin);
                if (balconyMesh) featuresGroup.add(balconyMesh);
            }
        }
        
        // Добавляем группу к зданию
        buildingMesh.add(featuresGroup);
        
        console.log(`[CellFeaturesManager] Прикреплено ${featuresGroup.children.length} мешей к зданию`);
    }
    
    /**
     * Создать меш окна в локальных координатах здания (без стекла)
     */
    _createWindowMeshLocal(cell, windowData, buildingPos, cos, sin) {
        const group = new THREE.Group();
        group.name = `window-local-${cell.key}`;
        
        const { width, height, depth } = windowData;
        const hw = width / 2;
        const hh = height / 2;
        const recessThickness = 0.08;  // Толщина откоса 8 см
        
        // Преобразуем мировые координаты в локальные
        const worldCx = cell.cx;
        const worldCy = cell.cy;
        const localCx = (worldCx - buildingPos.x) * cos - (worldCy - buildingPos.y) * sin;
        const localCy = (worldCx - buildingPos.x) * sin + (worldCy - buildingPos.y) * cos;
        const cz = cell.cz + (windowData.offsetZ || 0);
        
        // Нормаль в локальных координатах
        const localNx = cell.nx * cos - cell.ny * sin;
        const localNy = cell.nx * sin + cell.ny * cos;
        
        // Направление фасада в локальных координатах
        const localTx = cell.faceDirX * cos - cell.faceDirY * sin;
        const localTy = cell.faceDirX * sin + cell.faceDirY * cos;
        
        // Стекло УДАЛЕНО - оставляем только откосы
        
        // Нижний откос
        const bottomRecess = this._createRecessPlaneLocal(
            width, depth, recessThickness,
            localCx, localCy, cz - hh + recessThickness / 2,
            localNx, localNy, localTx, localTy,
            'bottom'
        );
        group.add(bottomRecess);
        
        // Верхний откос
        const topRecess = this._createRecessPlaneLocal(
            width, depth, recessThickness,
            localCx, localCy, cz + hh - recessThickness / 2,
            localNx, localNy, localTx, localTy,
            'top'
        );
        group.add(topRecess);
        
        // Левый откос
        const leftRecess = this._createRecessPlaneLocal(
            recessThickness, depth, height - recessThickness * 2,
            localCx - localTx * (hw - recessThickness / 2),
            localCy - localTy * (hw - recessThickness / 2),
            cz,
            localNx, localNy, localTx, localTy,
            'left'
        );
        group.add(leftRecess);
        
        // Правый откос
        const rightRecess = this._createRecessPlaneLocal(
            recessThickness, depth, height - recessThickness * 2,
            localCx + localTx * (hw - recessThickness / 2),
            localCy + localTy * (hw - recessThickness / 2),
            cz,
            localNx, localNy, localTx, localTy,
            'right'
        );
        group.add(rightRecess);
        
        // Помечаем группу
        group.userData.isWindow = true;
        group.userData.cellKey = cell.key;
        
        return group;
    }
    
    /**
     * Создать плоский откос в локальных координатах
     */
    _createRecessPlaneLocal(planeWidth, planeDepth, planeHeight, cx, cy, cz, nx, ny, tx, ty, side) {
        const geometry = new THREE.BufferGeometry();
        let vertices;
        
        if (side === 'bottom' || side === 'top') {
            // Горизонтальный откос
            const hw = planeWidth / 2;
            const z = cz;
            
            const v0 = [cx - tx * hw, cy - ty * hw, z];
            const v1 = [cx + tx * hw, cy + ty * hw, z];
            const v2 = [cx + tx * hw + nx * planeDepth, cy + ty * hw + ny * planeDepth, z];
            const v3 = [cx - tx * hw + nx * planeDepth, cy - ty * hw + ny * planeDepth, z];
            
            vertices = new Float32Array([
                ...v0, ...v1, ...v2,
                ...v0, ...v2, ...v3
            ]);
        } else {
            // Вертикальный откос
            const hh = planeHeight / 2;
            
            const v0 = [cx, cy, cz - hh];
            const v1 = [cx, cy, cz + hh];
            const v2 = [cx + nx * planeDepth, cy + ny * planeDepth, cz + hh];
            const v3 = [cx + nx * planeDepth, cy + ny * planeDepth, cz - hh];
            
            vertices = new Float32Array([
                ...v0, ...v1, ...v2,
                ...v0, ...v2, ...v3
            ]);
        }
        
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geometry.computeVertexNormals();
        
        const mesh = new THREE.Mesh(geometry, this.materials.windowRecess.clone());
        mesh.userData.isWindowRecess = true;
        mesh.userData.recessSide = side;
        
        return mesh;
    }
    
    /**
     * Создать меш балкона в локальных координатах здания
     */
    _createBalconyMeshLocal(cell, balconyData, buildingPos, cos, sin) {
        const group = new THREE.Group();
        group.name = `balcony-local-${cell.key}`;
        
        const { depth, height } = balconyData;
        const z0 = cell.z1;
        const balconyWidth = cell.cellWidth;
        
        // Преобразуем мировые координаты в локальные
        const worldBaseX = cell.bottomCenterX;
        const worldBaseY = cell.bottomCenterY;
        const localBaseX = (worldBaseX - buildingPos.x) * cos - (worldBaseY - buildingPos.y) * sin;
        const localBaseY = (worldBaseX - buildingPos.x) * sin + (worldBaseY - buildingPos.y) * cos;
        
        // Нормаль в локальных координатах
        const localNx = cell.nx * cos - cell.ny * sin;
        const localNy = cell.nx * sin + cell.ny * cos;
        
        // Плита балкона
        const slabGeom = new THREE.BoxGeometry(balconyWidth, depth, height);
        const slabMesh = new THREE.Mesh(slabGeom, this.materials.balconySlab.clone());
        
        slabMesh.position.set(
            localBaseX + localNx * (depth / 2),
            localBaseY + localNy * (depth / 2),
            z0 + height / 2
        );
        
        const angle = Math.atan2(localNy, localNx);
        slabMesh.rotation.z = angle - Math.PI / 2;
        
        slabMesh.userData.isBalcony = true;
        slabMesh.userData.cellKey = cell.key;
        
        group.add(slabMesh);
        
        return group;
    }
    
    /**
     * Получить все меши для raycast (откосы и балконы)
     */
    getRaycastMeshes(buildingMesh) {
        const meshes = [];
        
        const featuresGroup = buildingMesh?.children.find(c => c.name === 'buildingFeatures');
        if (!featuresGroup) return meshes;
        
        featuresGroup.traverse((obj) => {
            if (obj.isMesh && (obj.userData.isWindowRecess || obj.userData.isBalcony)) {
                meshes.push(obj);
            }
        });
        
        return meshes;
    }
    
    /**
     * Сдвинуть индексы фасадов при удалении вершины
     * @param {number} deletedFacadeIndex - индекс удаляемого фасада
     * @param {number} totalFacades - общее количество фасадов до удаления
     */
    shiftFacadeIndices(deletedFacadeIndex, totalFacades) {
        const newFeatures = new Map();
        
        for (const [key, features] of this.cellFeatures) {
            const parts = key.split('-');
            const fi = parseInt(parts[0]);
            const col = parseInt(parts[1]);
            const row = parseInt(parts[2]);
            
            if (fi === deletedFacadeIndex) {
                // Удаляем features для удаляемого фасада
                const cached = this.meshCache.get(key);
                if (cached) {
                    if (cached.windowMesh) {
                        this.featuresGroup.remove(cached.windowMesh);
                        this._disposeMesh(cached.windowMesh);
                    }
                    if (cached.balconyMesh) {
                        this.featuresGroup.remove(cached.balconyMesh);
                        this._disposeMesh(cached.balconyMesh);
                    }
                    this.meshCache.delete(key);
                }
                continue;
            }
            
            // Сдвигаем индекс фасада
            let newFi = fi;
            if (fi > deletedFacadeIndex) {
                newFi = fi - 1;
            }
            
            const newKey = `${newFi}-${col}-${row}`;
            newFeatures.set(newKey, features);
            
            // Обновляем meshCache
            const cached = this.meshCache.get(key);
            if (cached) {
                this.meshCache.delete(key);
                this.meshCache.set(newKey, cached);
            }
        }
        
        this.cellFeatures = newFeatures;
        console.log('[CellFeaturesManager] shiftFacadeIndices: осталось', this.cellFeatures.size, 'features');
    }
    
    /**
     * Сдвинуть индексы колонок при удалении вертикальной линии
     * @param {number} facadeIndex - индекс фасада
     * @param {number} deletedCol - индекс удаляемой колонки
     * @param {number} totalCols - общее количество колонок до удаления
     */
    shiftColumnIndices(facadeIndex, deletedCol, totalCols) {
        const newFeatures = new Map();
        
        for (const [key, features] of this.cellFeatures) {
            const parts = key.split('-');
            const fi = parseInt(parts[0]);
            const col = parseInt(parts[1]);
            const row = parseInt(parts[2]);
            
            if (fi !== facadeIndex) {
                // Другие фасады не меняем
                newFeatures.set(key, features);
                continue;
            }
            
            // Колонки слева от удалённой линии:
            // col 0 между линиями 0-1, col 1 между 1-2 и т.д.
            // При удалении линии deletedCol:
            // - колонка deletedCol-1 расширяется (объединяется с deletedCol)
            // - колонки >= deletedCol сдвигаются влево
            
            if (col === deletedCol - 1 || col === deletedCol) {
                // Объединённая колонка - оставляем features от меньшего индекса
                if (col === deletedCol - 1) {
                    const newKey = `${fi}-${col}-${row}`;
                    newFeatures.set(newKey, features);
                    // Для col === deletedCol просто не добавляем
                }
                // Для col === deletedCol - удаляем
                if (col === deletedCol) {
                    const cached = this.meshCache.get(key);
                    if (cached) {
                        if (cached.windowMesh) {
                            this.featuresGroup.remove(cached.windowMesh);
                            this._disposeMesh(cached.windowMesh);
                        }
                        if (cached.balconyMesh) {
                            this.featuresGroup.remove(cached.balconyMesh);
                            this._disposeMesh(cached.balconyMesh);
                        }
                        this.meshCache.delete(key);
                    }
                }
            } else if (col > deletedCol) {
                // Сдвигаем влево
                const newKey = `${fi}-${col - 1}-${row}`;
                newFeatures.set(newKey, features);
                
                const cached = this.meshCache.get(key);
                if (cached) {
                    this.meshCache.delete(key);
                    this.meshCache.set(newKey, cached);
                }
            } else {
                // col < deletedCol - 1, оставляем как есть
                newFeatures.set(key, features);
            }
        }
        
        this.cellFeatures = newFeatures;
        console.log('[CellFeaturesManager] shiftColumnIndices: осталось', this.cellFeatures.size, 'features');
    }
    
    /**
     * Сдвинуть индексы строк при удалении горизонтальной линии
     * @param {number} deletedRow - индекс удаляемой строки (линии)
     * @param {number} totalRows - общее количество строк до удаления
     * @param {number} totalFacades - общее количество фасадов
     */
    shiftRowIndices(deletedRow, totalRows, totalFacades) {
        const newFeatures = new Map();
        
        for (const [key, features] of this.cellFeatures) {
            const parts = key.split('-');
            const fi = parseInt(parts[0]);
            const col = parseInt(parts[1]);
            const row = parseInt(parts[2]);
            
            // Аналогично колонкам
            if (row === deletedRow - 1 || row === deletedRow) {
                if (row === deletedRow - 1) {
                    const newKey = `${fi}-${col}-${row}`;
                    newFeatures.set(newKey, features);
                }
                if (row === deletedRow) {
                    const cached = this.meshCache.get(key);
                    if (cached) {
                        if (cached.windowMesh) {
                            this.featuresGroup.remove(cached.windowMesh);
                            this._disposeMesh(cached.windowMesh);
                        }
                        if (cached.balconyMesh) {
                            this.featuresGroup.remove(cached.balconyMesh);
                            this._disposeMesh(cached.balconyMesh);
                        }
                        this.meshCache.delete(key);
                    }
                }
            } else if (row > deletedRow) {
                const newKey = `${fi}-${col}-${row - 1}`;
                newFeatures.set(newKey, features);
                
                const cached = this.meshCache.get(key);
                if (cached) {
                    this.meshCache.delete(key);
                    this.meshCache.set(newKey, cached);
                }
            } else {
                newFeatures.set(key, features);
            }
        }
        
        this.cellFeatures = newFeatures;
        console.log('[CellFeaturesManager] shiftRowIndices: осталось', this.cellFeatures.size, 'features');
    }
}

export { CellFeaturesManager };
window.CellFeaturesManager = CellFeaturesManager;