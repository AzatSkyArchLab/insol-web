/**
 * ============================================
 * SolarPotential.js
 * Расчёт инсоляционного потенциала территории
 * ============================================
 * 
 * Цель: показать максимальный объём, который можно построить
 * БЕЗ ухудшения инсоляции существующих жилых зданий.
 * 
 * Алгоритм:
 * 1. Baseline — сохраняем статус каждой точки ДО потенциала
 * 2. Все ячейки растут вместе (3м, 6м, 9м...)
 * 3. На каждом шаге: пересчитываем инсоляцию через calculatePoint
 * 4. Если точка ухудшилась → находим виновную ячейку → откат и стоп
 * 5. В конце: merge всех ячеек в один mesh
 */

class SolarPotential {
    constructor(sceneManager, insolationCalculator, insolationGrid, options = {}) {
        this.sceneManager = sceneManager;
        this.scene = sceneManager.scene;
        this.calculator = insolationCalculator;
        this.insolationGrid = insolationGrid;
        
        // Параметры
        this.cellSize = options.cellSize || 6;       // Размер кубика
        this.heightStep = options.heightStep || 6;   // Не используется в новом алгоритме
        this.maxHeight = options.maxHeight || 75;
        this.minHeight = options.minHeight || 6;
        this.animationDelay = options.animationDelay || 10;
        this.fastMode = options.fastMode !== undefined ? options.fastMode : false; // Без анимации
        
        // Цвет
        this.potentialColor = 0xffeb3b;
        this.potentialOpacity = 0.35;
        
        // Данные
        this.cells = [];      // Для обратной совместимости
        this.cubes = [];      // Кубики
        this.gridPositions = []; // 2D сетка позиций
        this.tempMeshes = [];
        this.resultMesh = null;
        this.edgesMesh = null;
        this.groundOutline = null;
        this.controlPanel = null;
        this.ghostMode = false;
        this.isBlocked = false;
        this.isHidden = false;
        this.isFootprintHidden = false;
        this.isSelected = false;
        this.meshToCellMap = new Map();
        this._activeMeshesCache = null;
        this._activeMeshesDirty = true;
        
        // Baseline: статус каждой точки ДО потенциала
        this.baselineStatus = new Map();
        this.baselineMinutes = new Map();
        
        // Raycaster для поиска виновника
        this.raycaster = new THREE.Raycaster();
        this.raycaster.far = 500;
        
        // Reusable Vector3 для оптимизации
        this._tempVector = new THREE.Vector3();
        
        // UI overlay для прогресса
        this.progressOverlay = null;
        
        // Состояние
        this.isCalculating = false;
        this.isCancelled = false;
        
        // Callbacks
        this.onProgress = options.onProgress || (() => {});
        this.onComplete = options.onComplete || (() => {});
        
        console.log('[SolarPotential] Создан');
    }
    
    /**
     * Показать диалог настроек и запустить расчёт
     */
    async showSettingsAndCalculate(polygonPoints) {
        const input = prompt(
            'Инсоляционный потенциал\n\n' +
            'Введите максимальную высоту (м):\n' +
            'Опции:\n' +
            '  f - быстрый режим\n' +
            '  c - крупные кубики 12м (быстрее, грубее)\n\n' +
            'По умолчанию: кубики 6×6×6м\n' +
            'Примеры: 75, 75f, 75fc',
            String(this.maxHeight)
        );
        
        if (input === null) return null;
        
        // Парсим опции
        const fastFlag = input.toLowerCase().includes('f');
        const coarseFlag = input.toLowerCase().includes('c');
        const heightStr = input.replace(/[fFcC]/g, '').trim();
        
        const height = parseInt(heightStr, 10);
        if (isNaN(height) || height < 6 || height > 500) {
            alert('Введите число от 6 до 500');
            return null;
        }
        
        this.maxHeight = height;
        this.fastMode = fastFlag;
        
        if (coarseFlag) {
            this.cellSize = 12;
            console.log('[SolarPotential] Крупные кубики: 12м');
        }
        
        if (fastFlag) {
            console.log('[SolarPotential] Быстрый режим');
        }
        
        const result = await this.calculate(polygonPoints);
        
        // Сбрасываем настройки
        this.cellSize = 6;
        this.fastMode = false;
        
        return result;
    }
    
    /**
     * Показать спиннер (стиль Mapbox)
     */
    _showProgress() {
        // Добавляем стили один раз
        if (!document.getElementById('solar-potential-styles')) {
            const style = document.createElement('style');
            style.id = 'solar-potential-styles';
            style.textContent = `
                @keyframes solar-potential-spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }
        
        if (!this.progressOverlay) {
            this.progressOverlay = document.createElement('div');
            this.progressOverlay.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 10000;
                background: white;
                padding: 12px 16px;
                border-radius: 4px;
                box-shadow: 0 0 0 1px rgba(0,0,0,0.1), 0 2px 6px rgba(0,0,0,0.15);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 12px;
                display: flex;
                align-items: center;
                gap: 10px;
            `;
            document.body.appendChild(this.progressOverlay);
        }
        
        this.progressOverlay.innerHTML = `
            <div style="
                width: 16px;
                height: 16px;
                border: 2px solid #e5e5e5;
                border-top-color: #3887be;
                border-radius: 50%;
                animation: solar-potential-spin 0.8s linear infinite;
            "></div>
            <span style="color: #333;">Расчёт потенциала</span>
            <button id="solar-potential-cancel" style="
                background: none;
                border: none;
                color: #999;
                cursor: pointer;
                font-size: 18px;
                padding: 0 0 0 8px;
                line-height: 1;
            ">×</button>
        `;
        
        const cancelBtn = document.getElementById('solar-potential-cancel');
        if (cancelBtn) {
            cancelBtn.onclick = () => this.cancel();
        }
    }
    
    /**
     * Скрыть overlay
     */
    _hideProgress() {
        if (this.progressOverlay) {
            this.progressOverlay.remove();
            this.progressOverlay = null;
        }
    }
    
    /**
     * Основной расчёт — СТРАТЕГИЯ РОСТА
     * Растём снизу вверх, проверяем только при коллизии
     */
    async calculate(polygonPoints) {
        if (this.isCalculating) {
            console.warn('[SolarPotential] Расчёт уже выполняется');
            return null;
        }
        
        if (!polygonPoints || polygonPoints.length < 3) {
            console.error('[SolarPotential] Недостаточно точек');
            return null;
        }
        
        if (!this.calculator || !this.calculator.sunVectors || this.calculator.sunVectors.length === 0) {
            alert('Солнечные векторы не загружены');
            return null;
        }
        
        const existingPoints = this._getExistingBuildingPoints();
        if (existingPoints.length === 0) {
            alert('Нет точек инсоляции на существующих зданиях.\n\nСначала создайте сетку на жилых зданиях.');
            return null;
        }
        
        this.isCalculating = true;
        this.isCancelled = false;
        
        const startTime = performance.now();
        console.log(`[SolarPotential] Старт. Точек: ${existingPoints.length}, макс: ${this.maxHeight}м`);
        
        // Показываем спиннер
        this._showProgress();
        
        // Кэшируем векторы
        this._cacheNormalizedSunVectors();
        
        // Сохраняем baseline
        this._saveBaseline(existingPoints);
        
        // Создаём 2D сетку позиций
        this._create2DGrid(polygonPoints);
        
        if (this.gridPositions.length === 0) {
            this._hideProgress();
            this.isCalculating = false;
            alert('Не удалось создать сетку');
            return null;
        }
        
        console.log(`[SolarPotential] Позиций в сетке: ${this.gridPositions.length}`);
        
        // Растём слой за слоем
        await this._growLayers(existingPoints);
        
        if (this.isCancelled) {
            this._clearTempMeshes();
            this._hideProgress();
            this.isCalculating = false;
            return null;
        }
        
        // Удаляем висящие кубики
        this._removeFloatingCubes();
        
        // Создаём финальный контур
        this._createFinalMeshFromCubes();
        
        // Удаляем временные меши
        this._clearTempMeshes();
        
        // Статистика
        const stats = this._calculateStats();
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
        
        this._hideProgress();
        
        // Показываем панель управления
        this._showControlPanel();
        
        console.log(`[SolarPotential] Готово за ${elapsed}с! Объём: ${stats.totalVolume.toFixed(0)} м³`);
        
        this.isCalculating = false;
        this.onComplete(stats);
        
        return stats;
    }
    
    /**
     * Показать панель управления потенциалом
     */
    _showControlPanel() {
        // Удаляем старую панель если есть
        this._hideControlPanel();
        
        // Находим кнопку "Потенциал" в тулбаре
        const potentialBtn = document.querySelector('[data-tool="potential"]');
        
        this.controlPanel = document.createElement('div');
        this.controlPanel.id = 'solar-potential-panel';
        
        if (potentialBtn) {
            // Позиционируем под кнопкой
            const rect = potentialBtn.getBoundingClientRect();
            this.controlPanel.style.cssText = `
                position: fixed;
                top: ${rect.bottom + 8}px;
                left: ${rect.left}px;
                z-index: 9999;
                background: white;
                padding: 10px;
                border-radius: 4px;
                box-shadow: 0 0 0 1px rgba(0,0,0,0.1), 0 2px 6px rgba(0,0,0,0.15);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 11px;
                min-width: 140px;
            `;
        } else {
            // Fallback позиция
            this.controlPanel.style.cssText = `
                position: fixed;
                top: 60px;
                left: 400px;
                z-index: 9999;
                background: white;
                padding: 10px;
                border-radius: 4px;
                box-shadow: 0 0 0 1px rgba(0,0,0,0.1), 0 2px 6px rgba(0,0,0,0.15);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 11px;
                min-width: 140px;
            `;
        }
        
        this.controlPanel.innerHTML = `
            <div style="font-weight: 500; margin-bottom: 10px; color: #333;">
                ☀️ Потенциал
                <button id="sp-close" style="float: right; background: none; border: none; cursor: pointer; color: #999; font-size: 14px;">×</button>
            </div>
            <div style="display: flex; flex-direction: column; gap: 6px;">
                <button id="sp-block" class="sp-btn">
                    🔓 Разблокирован
                </button>
                <button id="sp-visibility" class="sp-btn">
                    👁 Видимый
                </button>
                <button id="sp-footprint" class="sp-btn">
                    ⬡ Футпринт
                </button>
            </div>
            <style>
                .sp-btn {
                    background: #f5f5f5;
                    border: 1px solid #ddd;
                    padding: 6px 10px;
                    border-radius: 4px;
                    cursor: pointer;
                    text-align: left;
                    font-size: 12px;
                    transition: all 0.15s;
                }
                .sp-btn:hover {
                    background: #eee;
                    border-color: #ccc;
                }
                .sp-btn.active {
                    background: #e3f2fd;
                    border-color: #90caf9;
                    color: #1976d2;
                }
            </style>
        `;
        
        document.body.appendChild(this.controlPanel);
        
        // Обработчики
        document.getElementById('sp-close').onclick = () => this._hideControlPanel();
        
        document.getElementById('sp-block').onclick = () => {
            this.toggleBlock();
            this._updateControlPanel();
        };
        
        document.getElementById('sp-visibility').onclick = () => {
            this.toggleVisibility();
            this._updateControlPanel();
        };
        
        document.getElementById('sp-footprint').onclick = () => {
            this.toggleFootprint();
            this._updateControlPanel();
        };
    }
    
    /**
     * Обновить состояние кнопок панели
     */
    _updateControlPanel() {
        if (!this.controlPanel) return;
        
        const blockBtn = document.getElementById('sp-block');
        const visBtn = document.getElementById('sp-visibility');
        const footBtn = document.getElementById('sp-footprint');
        
        if (blockBtn) {
            blockBtn.textContent = this.isBlocked ? '🔒 Заблокирован' : '🔓 Разблокирован';
            blockBtn.classList.toggle('active', this.isBlocked);
        }
        
        if (visBtn) {
            visBtn.textContent = this.isHidden ? '👁‍🗨 Скрыт' : '👁 Видимый';
            visBtn.classList.toggle('active', this.isHidden);
        }
        
        if (footBtn) {
            footBtn.textContent = this.isFootprintHidden ? '⬡ Футпринт скрыт' : '⬡ Футпринт';
            footBtn.classList.toggle('active', this.isFootprintHidden);
        }
    }
    
    /**
     * Скрыть панель управления
     */
    _hideControlPanel() {
        if (this.controlPanel) {
            this.controlPanel.remove();
            this.controlPanel = null;
        }
    }
    
    /**
     * Показать панель (публичный метод для вызова при клике)
     */
    showPanel() {
        if (this.resultMesh) {
            this._showControlPanel();
        }
    }
    
    /**
     * Скрыть панель (публичный метод)
     */
    hidePanel() {
        this._hideControlPanel();
    }
    
    /**
     * Создать 2D сетку позиций (x, y)
     */
    _create2DGrid(polygonPoints) {
        this.gridPositions = [];
        this.cubes = [];
        
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        
        for (const p of polygonPoints) {
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
        }
        
        const halfCell = this.cellSize / 2;
        
        for (let x = minX + halfCell; x < maxX; x += this.cellSize) {
            for (let y = minY + halfCell; y < maxY; y += this.cellSize) {
                if (this._pointInPolygon(x, y, polygonPoints)) {
                    this.gridPositions.push({ x, y, maxZ: 0 });
                }
            }
        }
    }
    
    /**
     * Расти слой за слоем
     */
    async _growLayers(existingPoints) {
        const sunVectors = this.normalizedSunVectors;
        const group = this.sceneManager.getBuildingsGroup();
        
        const material = new THREE.MeshLambertMaterial({
            color: this.potentialColor,
            transparent: true,
            opacity: 0.5,
            side: THREE.DoubleSide
        });
        
        const boxGeom = new THREE.BoxGeometry(this.cellSize, this.cellSize, this.cellSize);
        
        // Фильтруем точки — только не-FAIL
        const checkPoints = [];
        for (let i = 0; i < existingPoints.length; i++) {
            if (this.baselineStatus.get(i) !== 'FAIL') {
                checkPoints.push({ index: i, point: existingPoints[i] });
            }
        }
        
        const levels = Math.ceil(this.maxHeight / this.cellSize);
        
        // Активные позиции
        const activePositions = new Set(this.gridPositions.map((_, i) => i));
        
        // Batch размер — проверяем каждые N слоёв
        const batchSize = 3;
        let batchCubes = [];
        
        for (let level = 0; level < levels && !this.isCancelled; level++) {
            const z = level * this.cellSize;
            
            if (activePositions.size === 0) break;
            
            // Создаём кубики на этом уровне
            for (const posIndex of activePositions) {
                const pos = this.gridPositions[posIndex];
                
                const cube = {
                    x: pos.x,
                    y: pos.y,
                    z: z,
                    size: this.cellSize,
                    removed: false,
                    mesh: null,
                    posIndex: posIndex
                };
                
                const mesh = new THREE.Mesh(boxGeom.clone(), material.clone());
                mesh.position.set(cube.x, cube.y, z + this.cellSize / 2);
                mesh.userData = { type: 'building', subtype: 'solar-potential-temp' };
                mesh.updateMatrix();
                mesh.updateMatrixWorld(true);
                
                group.add(mesh);
                this.tempMeshes.push(mesh);
                cube.mesh = mesh;
                this.meshToCellMap.set(mesh, cube);
                
                this.cubes.push(cube);
                batchCubes.push(cube);
            }
            
            // Пауза для анимации
            if (!this.fastMode) {
                await this._sleep(10);
            }
            
            // Проверяем каждые batchSize слоёв или на последнем
            if ((level + 1) % batchSize === 0 || level === levels - 1) {
                if (batchCubes.length > 0) {
                    const affectedPoints = this._findAffectedPoints(checkPoints, batchCubes, sunVectors);
                    
                    if (affectedPoints.length > 0) {
                        await this._fixViolationsForPoints(affectedPoints, sunVectors, activePositions, batchCubes);
                    }
                    
                    batchCubes = [];
                }
            }
        }
        
        console.log(`[SolarPotential] Построено ${this.cubes.filter(c => !c.removed).length} кубиков`);
    }
    
    /**
     * Найти точки, затронутые новыми кубиками (быстрый raycast)
     */
    _findAffectedPoints(checkPoints, newCubes, sunVectors) {
        const affected = [];
        const newMeshes = newCubes.filter(c => !c.removed && c.mesh).map(c => c.mesh);
        
        if (newMeshes.length === 0) return affected;
        
        // BBox новых кубиков для быстрой фильтрации
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        
        for (const cube of newCubes) {
            minX = Math.min(minX, cube.x - cube.size);
            maxX = Math.max(maxX, cube.x + cube.size);
            minY = Math.min(minY, cube.y - cube.size);
            maxY = Math.max(maxY, cube.y + cube.size);
            minZ = Math.min(minZ, cube.z);
            maxZ = Math.max(maxZ, cube.z + cube.size);
        }
        
        const maxDist = 500;
        
        // Проверяем каждый 4-й луч для скорости
        const sparseVectors = sunVectors.filter((_, i) => i % 4 === 0);
        
        for (const cp of checkPoints) {
            const pos = cp.point.position;
            
            // Если точка выше новых кубиков — пропускаем
            if (pos.z > maxZ + 10) continue;
            
            let isAffected = false;
            
            for (const dir of sparseVectors) {
                this.raycaster.set(pos, dir);
                this.raycaster.far = maxDist;
                const hits = this.raycaster.intersectObjects(newMeshes, false);
                
                if (hits.length > 0 && hits[0].distance > 0.5) {
                    isAffected = true;
                    break;
                }
            }
            
            if (isAffected) {
                affected.push(cp);
            }
        }
        
        return affected;
    }
    
    /**
     * Исправить нарушения для конкретных точек
     */
    async _fixViolationsForPoints(affectedPoints, sunVectors, activePositions, batchCubes) {
        let iterations = 0;
        const maxIterations = 30;
        
        while (!this.isCancelled && iterations < maxIterations) {
            iterations++;
            let removedAny = false;
            
            // Активные меши — ВСЕ, не только batch
            const activeMeshes = this.tempMeshes.filter(m => m.visible);
            
            for (const { index, point } of affectedPoints) {
                const result = this.calculator.calculatePoint(point, null, 120);
                const currentStatus = result ? result.evaluation.status : 'PASS';
                const baselineStatus = this.baselineStatus.get(index);
                
                if (this._isDegraded(baselineStatus, currentStatus)) {
                    // Ищем ПЕРВЫЙ блокирующий кубик среди ВСЕХ активных (полные лучи)
                    const blocker = this._findFirstBlockingCubeIn(point, sunVectors, activeMeshes);
                    
                    if (blocker && !blocker.removed) {
                        blocker.removed = true;
                        if (blocker.mesh) blocker.mesh.visible = false;
                        activePositions.delete(blocker.posIndex);
                        removedAny = true;
                    }
                }
            }
            
            if (!removedAny) break;
        }
        
        if (iterations >= maxIterations) {
            console.warn(`[SolarPotential] Достигнут лимит итераций (${maxIterations})`);
        }
    }
    
    /**
     * ФИНАЛЬНАЯ ПРОВЕРКА КОРРЕКТНОСТИ
     * Проверяем ВСЕ точки строго и удаляем блокирующие кубики
     */
    async _finalValidation(existingPoints) {
        const sunVectors = this.normalizedSunVectors;
        
        // Проверяем ВСЕ не-FAIL точки
        const checkPoints = [];
        for (let i = 0; i < existingPoints.length; i++) {
            if (this.baselineStatus.get(i) !== 'FAIL') {
                checkPoints.push({ index: i, point: existingPoints[i] });
            }
        }
        
        console.log(`[SolarPotential] Финальная проверка ${checkPoints.length} точек...`);
        
        let totalRemoved = 0;
        let iteration = 0;
        const maxIterations = 100;
        
        while (!this.isCancelled && iteration < maxIterations) {
            iteration++;
            let removedThisIteration = 0;
            
            // Активные меши
            const activeMeshes = this.tempMeshes.filter(m => m.visible);
            
            if (activeMeshes.length === 0) break;
            
            for (const { index, point } of checkPoints) {
                // Строгая проверка через calculatePoint
                const result = this.calculator.calculatePoint(point, null, 120);
                const currentStatus = result ? result.evaluation.status : 'PASS';
                const baselineStatus = this.baselineStatus.get(index);
                
                if (this._isDegraded(baselineStatus, currentStatus)) {
                    // Ищем первый блокирующий кубик (все лучи, не sparse)
                    const blocker = this._findFirstBlockingCubeIn(point, sunVectors, activeMeshes);
                    
                    if (blocker && !blocker.removed) {
                        blocker.removed = true;
                        if (blocker.mesh) blocker.mesh.visible = false;
                        removedThisIteration++;
                        totalRemoved++;
                    }
                }
            }
            
            if (removedThisIteration === 0) {
                break;
            }
        }
        
        if (totalRemoved > 0) {
            console.log(`[SolarPotential] Финальная проверка: удалено ${totalRemoved} кубиков за ${iteration} итераций`);
        } else {
            console.log(`[SolarPotential] Финальная проверка: OK, нарушений нет`);
        }
    }
    
    /**
     * Удалить кубики без опоры снизу
     */
    _removeFloatingCubes() {
        const positionMap = new Map();
        
        for (const cube of this.cubes) {
            if (cube.removed) continue;
            const key = `${cube.x},${cube.y}`;
            if (!positionMap.has(key)) {
                positionMap.set(key, []);
            }
            positionMap.get(key).push(cube);
        }
        
        let removedCount = 0;
        
        for (const [key, column] of positionMap) {
            column.sort((a, b) => a.z - b.z);
            
            let lastZ = -this.cellSize;
            
            for (const cube of column) {
                if (cube.z > lastZ + this.cellSize + 0.1) {
                    for (const c of column) {
                        if (c.z >= cube.z && !c.removed) {
                            c.removed = true;
                            if (c.mesh) c.mesh.visible = false;
                            removedCount++;
                        }
                    }
                    break;
                }
                lastZ = cube.z;
            }
        }
        
        if (removedCount > 0) {
            console.log(`[SolarPotential] Удалено ${removedCount} висящих кубиков`);
        }
    }
    
    /**
     * Найти ПЕРВЫЙ кубик на луче
     */
    _findFirstBlockingCubeIn(point, normalizedVectors, activeMeshes) {
        const pointPos = point.position;
        
        for (const direction of normalizedVectors) {
            this.raycaster.set(pointPos, direction);
            const hits = this.raycaster.intersectObjects(activeMeshes, false);
            
            if (hits.length > 0 && hits[0].distance > 0.5) {
                const cube = this.meshToCellMap.get(hits[0].object);
                if (cube && !cube.removed) {
                    return cube;
                }
            }
        }
        
        return null;
    }
    
    /**
     * Создать финальный mesh — колонки (выдавливание от земли)
     */
    _createFinalMeshFromCubes() {
        const activeCubes = this.cubes.filter(c => !c.removed);
        
        if (activeCubes.length === 0) {
            console.log('[SolarPotential] Нет активных кубиков');
            return;
        }
        
        // Группируем кубики по позиции x,y и находим максимальную высоту
        const columns = new Map();
        
        for (const cube of activeCubes) {
            const key = `${cube.x},${cube.y}`;
            if (!columns.has(key)) {
                columns.set(key, { x: cube.x, y: cube.y, maxZ: 0 });
            }
            const col = columns.get(key);
            col.maxZ = Math.max(col.maxZ, cube.z + cube.size);
        }
        
        // Создаём геометрии колонок (выдавливание от земли)
        const geometries = [];
        
        for (const [key, col] of columns) {
            const height = col.maxZ;
            if (height <= 0) continue;
            
            // Колонка от 0 до maxZ
            const geom = new THREE.BoxGeometry(this.cellSize, this.cellSize, height);
            geom.translate(col.x, col.y, height / 2);
            geometries.push(geom);
        }
        
        if (geometries.length === 0) {
            console.log('[SolarPotential] Нет колонок');
            return;
        }
        
        // Объединяем в единую геометрию
        const merged = this._mergeGeometries(geometries);
        merged.computeBoundingBox();
        merged.computeBoundingSphere();
        
        for (const g of geometries) g.dispose();
        
        // Контур объёма — светло-серый
        const edgesGeom = new THREE.EdgesGeometry(merged, 45);
        const edgesMaterial = new THREE.LineBasicMaterial({ 
            color: 0xaaaaaa,
            linewidth: 1,
            transparent: true,
            opacity: 0.6
        });
        
        this.edgesMesh = new THREE.LineSegments(edgesGeom, edgesMaterial);
        
        // Прозрачный mesh для raycast (НЕ видимый по умолчанию)
        const meshMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffcc,
            transparent: true,
            opacity: 0,
            side: THREE.DoubleSide
        });
        
        this.resultMesh = new THREE.Mesh(merged, meshMaterial);
        this.resultMesh.userData = {
            id: `solar-potential-${Date.now()}`,
            type: 'building',
            subtype: 'solar-potential',
            properties: {
                height: this.maxHeight,
                isResidential: false
            }
        };
        
        // Контур как дочерний элемент
        this.resultMesh.add(this.edgesMesh);
        
        this.resultMesh.updateMatrix();
        this.resultMesh.updateMatrixWorld(true);
        
        const group = this.sceneManager.getBuildingsGroup();
        group.add(this.resultMesh);
        
        // Футпринт ОТДЕЛЬНО от resultMesh (независимый)
        this._createGroundOutline(columns);
        
        this.ghostMode = false;
        this.isHidden = false;
        this.isBlocked = false;
        this.isSelected = false;
        
        console.log(`[SolarPotential] Создано ${columns.size} колонок`);
    }
    
    /**
     * Создать контур на земле (футпринт) — НЕЗАВИСИМЫЙ от resultMesh
     */
    _createGroundOutline(columns) {
        if (!columns || columns.size === 0) return;
        
        const halfSize = this.cellSize / 2;
        
        // Собираем все рёбра нижних граней
        const edges = new Set();
        
        for (const [key, col] of columns) {
            const x = col.x;
            const y = col.y;
            
            // 4 ребра нижней грани
            const corners = [
                [x - halfSize, y - halfSize],
                [x + halfSize, y - halfSize],
                [x + halfSize, y + halfSize],
                [x - halfSize, y + halfSize]
            ];
            
            for (let i = 0; i < 4; i++) {
                const a = corners[i];
                const b = corners[(i + 1) % 4];
                
                // Ключ ребра (сортируем чтобы A-B = B-A)
                const edgeKey = [a, b].sort((p1, p2) => p1[0] - p2[0] || p1[1] - p2[1])
                    .map(p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('|');
                
                if (edges.has(edgeKey)) {
                    edges.delete(edgeKey); // Внутреннее ребро — удаляем
                } else {
                    edges.add(edgeKey);
                }
            }
        }
        
        // Преобразуем рёбра в линии
        const positions = [];
        
        for (const edgeKey of edges) {
            const [p1, p2] = edgeKey.split('|').map(s => s.split(',').map(Number));
            positions.push(p1[0], p1[1], 0.1); // Чуть выше земли
            positions.push(p2[0], p2[1], 0.1);
        }
        
        if (positions.length === 0) return;
        
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        
        const material = new THREE.LineBasicMaterial({
            color: 0x333333,  // Тёмно-серый
            linewidth: 2
        });
        
        this.groundOutline = new THREE.LineSegments(geometry, material);
        this.groundOutline.userData = { subtype: 'solar-potential-footprint' };
        
        // Добавляем НАПРЯМУЮ в группу (не как child resultMesh)
        const group = this.sceneManager.getBuildingsGroup();
        group.add(this.groundOutline);
    }
    
    /**
     * Заблокировать потенциал (не влияет на лучи)
     */
    block() {
        if (!this.resultMesh) return;
        
        this.isBlocked = true;
        this.resultMesh.userData.type = 'ghost';
        
        // Визуально — бледный
        if (this.edgesMesh) {
            this.edgesMesh.material.color.setHex(0xcccccc);
            this.edgesMesh.material.opacity = 0.4;
            this.edgesMesh.material.transparent = true;
        }
        
        console.log('[SolarPotential] Заблокирован — не влияет на лучи');
    }
    
    /**
     * Разблокировать потенциал (влияет на лучи)
     */
    unblock() {
        if (!this.resultMesh) return;
        
        this.isBlocked = false;
        this.resultMesh.userData.type = 'building';
        
        // Визуально — нормальный
        if (this.edgesMesh) {
            this.edgesMesh.material.color.setHex(0xaaaaaa);
            this.edgesMesh.material.opacity = 0.6;
            this.edgesMesh.material.transparent = true;
        }
        
        console.log('[SolarPotential] Разблокирован — влияет на лучи');
    }
    
    /**
     * Переключить блокировку
     */
    toggleBlock() {
        if (this.isBlocked) {
            this.unblock();
        } else {
            this.block();
        }
        return this.isBlocked;
    }
    
    /**
     * Скрыть потенциал (весь)
     */
    hide() {
        if (!this.resultMesh) return;
        
        this.isHidden = true;
        this.resultMesh.visible = false;
        
        console.log('[SolarPotential] Скрыт');
    }
    
    /**
     * Показать потенциал (весь)
     */
    show() {
        if (!this.resultMesh) return;
        
        this.isHidden = false;
        this.resultMesh.visible = true;
        
        console.log('[SolarPotential] Показан');
    }
    
    /**
     * Переключить видимость
     */
    toggleVisibility() {
        if (this.isHidden) {
            this.show();
        } else {
            this.hide();
        }
        return !this.isHidden;
    }
    
    /**
     * Скрыть футпринт (контур на земле)
     */
    hideFootprint() {
        if (!this.groundOutline) return;
        
        this.isFootprintHidden = true;
        this.groundOutline.visible = false;
        
        console.log('[SolarPotential] Футпринт скрыт');
    }
    
    /**
     * Показать футпринт (контур на земле)
     */
    showFootprint() {
        if (!this.groundOutline) return;
        
        this.isFootprintHidden = false;
        this.groundOutline.visible = true;
        
        console.log('[SolarPotential] Футпринт показан');
    }
    
    /**
     * Переключить видимость футпринта
     */
    toggleFootprint() {
        if (this.isFootprintHidden) {
            this.showFootprint();
        } else {
            this.hideFootprint();
        }
        return !this.isFootprintHidden;
    }
    
    /**
     * Выделить потенциал (светло-жёлтый)
     */
    select() {
        if (!this.resultMesh || this.isSelected) return;
        
        this.isSelected = true;
        
        // Показываем mesh светло-жёлтым
        this.resultMesh.material.visible = true;
        this.resultMesh.material.color = new THREE.Color(0xffffcc);
        this.resultMesh.material.transparent = true;
        this.resultMesh.material.opacity = 0.3;
        this.resultMesh.material.needsUpdate = true;
        
        // Контур ярче
        if (this.edgesMesh) {
            this.edgesMesh.material.color.setHex(0xffff00);
            this.edgesMesh.material.opacity = 1;
        }
    }
    
    /**
     * Снять выделение
     */
    deselect() {
        if (!this.resultMesh || !this.isSelected) return;
        
        this.isSelected = false;
        
        // Скрываем mesh
        this.resultMesh.material.visible = false;
        
        // Контур зависит от состояния блокировки
        if (this.edgesMesh) {
            if (this.isBlocked) {
                this.edgesMesh.material.color.setHex(0xcccccc);
                this.edgesMesh.material.opacity = 0.4;
            } else {
                this.edgesMesh.material.color.setHex(0xaaaaaa);
                this.edgesMesh.material.opacity = 0.6;
            }
        }
    }
    
    /**
     * Кэшировать нормализованные солнечные векторы
     */
    _cacheNormalizedSunVectors() {
        this.normalizedSunVectors = this.calculator.sunVectors.map(sv => 
            new THREE.Vector3(sv.x, sv.y, sv.z).normalize()
        );
    }
    
    /**
     * Сохранить baseline — статус каждой точки ДО создания потенциала
     */
    _saveBaseline(existingPoints) {
        this.baselineStatus.clear();
        this.baselineMinutes = new Map();  // Для отладки
        
        let pass = 0, warn = 0, fail = 0;
        
        for (let i = 0; i < existingPoints.length; i++) {
            const point = existingPoints[i];
            const result = this.calculator.calculatePoint(point, null, 120);
            const status = result ? result.evaluation.status : 'PASS';
            const minutes = result ? result.evaluation.totalMinutes : 0;
            
            this.baselineStatus.set(i, status);
            this.baselineMinutes.set(i, minutes);
            
            if (status === 'PASS') pass++;
            else if (status === 'WARNING') warn++;
            else fail++;
        }
        
        console.log(`[SolarPotential] Baseline: ${pass} PASS, ${warn} WARNING, ${fail} FAIL`);
        
        // Отладка первой точки
        if (existingPoints.length > 0) {
            console.log(`[SolarPotential] Точка 0 baseline: ${this.baselineStatus.get(0)} (${this.baselineMinutes.get(0)} мин)`);
        }
    }
    
    /**
     * Получить точки существующих зданий (не потенциала)
     */
    _getExistingBuildingPoints() {
        if (!this.insolationGrid) return [];
        
        // Проверяем что активное здание — не потенциал
        const activeMesh = this.insolationGrid.getActiveMesh();
        if (activeMesh) {
            const subtype = activeMesh.userData?.subtype || '';
            if (subtype.includes('solar-potential')) {
                console.warn('[SolarPotential] Сетка построена на потенциале, а не на здании');
                return [];
            }
        }
        
        return this.insolationGrid.getCalculationPoints();
    }
    
    /**
     * Создать сетку ячеек
     */
    _createGrid(polygonPoints) {
        this.cells = [];
        
        // Находим границы полигона
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        
        for (const p of polygonPoints) {
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
        }
        
        const halfCell = this.cellSize / 2;
        
        // Создаём ячейки внутри полигона
        for (let x = minX + halfCell; x < maxX; x += this.cellSize) {
            for (let y = minY + halfCell; y < maxY; y += this.cellSize) {
                if (this._pointInPolygon(x, y, polygonPoints)) {
                    this.cells.push({
                        x: x,
                        y: y,
                        height: this.minHeight,
                        finished: false,
                        mesh: null
                    });
                }
            }
        }
    }
    
    /**
     * Создать временные меши — как обычные здания
     * ОПТИМИЗИРОВАНО: создаём геометрию высотой 1м и используем scale
     */
    _createTempMeshes() {
        this._clearTempMeshes();
        
        const group = this.sceneManager.getBuildingsGroup();
        
        for (let i = 0; i < this.cells.length; i++) {
            const cell = this.cells[i];
            
            // Создаём Shape для ExtrudeGeometry
            const halfSize = this.cellSize / 2;
            const shape = new THREE.Shape();
            shape.moveTo(cell.x - halfSize, cell.y - halfSize);
            shape.lineTo(cell.x + halfSize, cell.y - halfSize);
            shape.lineTo(cell.x + halfSize, cell.y + halfSize);
            shape.lineTo(cell.x - halfSize, cell.y + halfSize);
            shape.closePath();
            
            // ОПТИМИЗАЦИЯ: создаём геометрию высотой 1м
            // Высоту регулируем через scale.z
            const geometry = new THREE.ExtrudeGeometry(shape, {
                depth: 1, // Базовая высота 1м
                bevelEnabled: false
            });
            
            // Важно для raycasting — как в DrawTool!
            geometry.computeBoundingBox();
            geometry.computeBoundingSphere();
            
            // Материал с DoubleSide — критично для raycast!
            const material = new THREE.MeshLambertMaterial({
                color: this.potentialColor,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: this.potentialOpacity
            });
            
            const mesh = new THREE.Mesh(geometry, material);
            
            // Устанавливаем высоту через scale
            mesh.scale.z = cell.height;
            
            // Явно visible = true
            mesh.visible = true;
            
            // userData как у обычного здания — чтобы участвовал в расчёте инсоляции
            mesh.userData = {
                id: `potential-cell-${Date.now()}-${i}`,
                type: 'building',
                subtype: 'solar-potential-temp',
                properties: {
                    height: cell.height,
                    isResidential: false
                }
            };
            
            mesh.updateMatrix();
            mesh.updateMatrixWorld(true);
            
            group.add(mesh);
            this.tempMeshes.push(mesh);
            cell.mesh = mesh;
            this.meshToCellMap.set(mesh, cell); // Кэш для быстрого поиска
        }
        
        // Проверяем что меши действительно в группе
        const buildingsAfter = group.children.filter(c => c.userData?.type === 'building').length;
        console.log(`[SolarPotential] Создано ${this.tempMeshes.length} временных мешей. Всего зданий в группе: ${buildingsAfter}`);
    }
    
    /**
     * Очистить временные меши
     */
    _clearTempMeshes() {
        const group = this.sceneManager.getBuildingsGroup();
        
        for (const mesh of this.tempMeshes) {
            group.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) mesh.material.dispose();
        }
        
        this.tempMeshes = [];
        this.meshToCellMap.clear(); // Очищаем кэш
        this._activeMeshesCache = null;
        this._activeMeshesDirty = true;
        
        for (const cell of this.cells) {
            cell.mesh = null;
        }
    }
    
    /**
     * Обновить высоту ячейки — ОПТИМИЗИРОВАНО: только scale, без пересоздания геометрии
     */
    _updateCellHeight(cell) {
        const mesh = cell.mesh;
        if (!mesh) return;
        
        // ОПТИМИЗАЦИЯ: меняем только scale.z вместо пересоздания геометрии
        mesh.scale.z = cell.height;
        
        mesh.userData.properties.height = cell.height;
        
        // Обновляем матрицы для raycaster
        mesh.updateMatrix();
        mesh.updateMatrixWorld(true);
    }
    
    /**
     * Растить все ячейки вместе
     */
    async _growAllCells(existingPoints) {
        let iteration = 0;
        const sunVectors = this.calculator.sunVectors;
        
        while (!this.isCancelled) {
            iteration++;
            
            // Получаем незавершённые ячейки
            const growing = this.cells.filter(c => !c.finished && c.height < this.maxHeight);
            
            if (growing.length === 0) {
                console.log(`[SolarPotential] Все ячейки завершены`);
                break;
            }
            
            // Поднимаем ВСЕ растущие ячейки на один шаг
            for (const cell of growing) {
                cell.height += this.heightStep;
                this._updateCellHeight(cell);
            }
            
            // Сбрасываем кэш активных мешей (высоты изменились)
            this._activeMeshesDirty = true;
            
            const currentHeight = growing[0]?.height || 0;
            
            // Логируем только каждые 5 итераций для скорости
            if (iteration % 5 === 1) {
                console.log(`[SolarPotential] Итерация ${iteration}: высота ${currentHeight}м, растёт ${growing.length} ячеек`);
            }
            
            // Проверяем ухудшение инсоляции и откатываем виновников
            // Повторяем пока есть ухудшения
            let rollbackIteration = 0;
            while (rollbackIteration < 20) { // Защита от бесконечного цикла
                rollbackIteration++;
                
                const violators = this._findViolatingCells(existingPoints, sunVectors);
                
                if (violators.size === 0) break;
                
                // Откатываем виновные ячейки
                for (const cell of violators) {
                    if (cell.height > this.minHeight) {
                        cell.height -= this.heightStep;
                        if (cell.height < this.minHeight) {
                            cell.height = this.minHeight;
                        }
                        this._updateCellHeight(cell);
                        this._activeMeshesDirty = true; // Геометрия изменилась
                    } else {
                        // Ячейка на минимуме и всё ещё затеняет — удаляем её
                        cell.height = 0;
                        cell.finished = true;
                        // Скрываем меш
                        if (cell.mesh) {
                            cell.mesh.visible = false;
                            this._activeMeshesDirty = true; // Инвалидируем кэш
                        }
                        console.log(`[SolarPotential] Ячейка удалена (затеняла на минимальной высоте)`);
                    }
                    
                    // Помечаем finished если достигли минимума
                    if (cell.height <= this.minHeight && cell.height > 0) {
                        cell.finished = true;
                        console.log(`[SolarPotential] Ячейка достигла минимума ${cell.height}м`);
                    }
                }
            }
            
            // Помечаем все откаченные ячейки как finished
            // (те что всё ещё могут затенять, но уже не растут)
            for (const cell of this.cells) {
                if (!cell.finished && cell.height < currentHeight) {
                    cell.finished = true;
                    console.log(`[SolarPotential] Ячейка остановлена на ${cell.height}м`);
                }
            }
            
            // Завершаем ячейки, достигшие потолка
            for (const cell of this.cells) {
                if (!cell.finished && cell.height >= this.maxHeight) {
                    cell.height = this.maxHeight;
                    cell.finished = true;
                    this._updateCellHeight(cell);
                }
            }
            
            // Прогресс
            const finished = this.cells.filter(c => c.finished).length;
            this.onProgress(finished / this.cells.length, iteration);
            
            // Пауза для анимации (пропускаем в fastMode)
            if (!this.fastMode && this.animationDelay > 0) {
                await this._sleep(this.animationDelay);
            }
        }
        
        console.log(`[SolarPotential] Рост завершён за ${iteration} итераций`);
    }
    
    /**
     * Найти ячейки, вызвавшие ухудшение инсоляции
     * ОПТИМИЗИРОВАНО: BBox фильтрация + кэшированные векторы + ранний выход
     */
    _findViolatingCells(existingPoints, sunVectors) {
        const violators = new Set();
        
        // Кэшируем активные меши если не изменились
        if (!this._activeMeshesCache || this._activeMeshesDirty) {
            this._activeMeshesCache = this.tempMeshes.filter(m => m.visible);
            this._activeMeshesDirty = false;
        }
        const activeMeshes = this._activeMeshesCache;
        
        if (activeMeshes.length === 0) return violators;
        
        // Используем кэшированные нормализованные векторы
        const normalizedVectors = this.normalizedSunVectors || sunVectors.map(sv => 
            new THREE.Vector3(sv.x, sv.y, sv.z).normalize()
        );
        
        // В быстром режиме проверяем только каждый 3-й луч для первичной фильтрации
        const rayStep = this.fastMode ? 3 : 1;
        
        // ШАГ 1: Быстрая проверка — какие точки затронуты потенциалом
        const affectedPoints = []; // {index, blockingCells}
        
        for (let i = 0; i < existingPoints.length; i++) {
            // ОПТИМИЗАЦИЯ: пропускаем точки, которые уже FAIL — им хуже не станет
            const baselineStatus = this.baselineStatus.get(i);
            if (baselineStatus === 'FAIL') continue;
            
            const point = existingPoints[i];
            const pos = point.position;
            
            // ОПТИМИЗАЦИЯ: быстрая проверка BBox — точка вообще рядом с потенциалом?
            if (this.potentialBounds) {
                const b = this.potentialBounds;
                if (pos.x < b.minX || pos.x > b.maxX || pos.y < b.minY || pos.y > b.maxY) {
                    continue; // Точка слишком далеко
                }
            }
            
            this._tempVector.copy(pos);
            const blockingCells = new Set();
            
            // Проверяем пересечение с потенциалом
            for (let v = 0; v < normalizedVectors.length; v += rayStep) {
                const direction = normalizedVectors[v];
                this.raycaster.set(this._tempVector, direction);
                const hits = this.raycaster.intersectObjects(activeMeshes, false);
                
                if (hits.length > 0 && hits[0].distance > 0.5) {
                    const cell = this.meshToCellMap.get(hits[0].object);
                    if (cell && cell.height > 0) {
                        blockingCells.add(cell);
                    }
                }
            }
            
            if (blockingCells.size > 0) {
                affectedPoints.push({ index: i, blockingCells });
            }
        }
        
        // Если нет затронутых точек — выходим быстро
        if (affectedPoints.length === 0) {
            return violators;
        }
        
        // ШАГ 2: Только для затронутых точек — полный расчёт инсоляции
        let degradedCount = 0;
        
        for (const { index, blockingCells } of affectedPoints) {
            const point = existingPoints[index];
            const baselineStatus = this.baselineStatus.get(index);
            
            // Полный расчёт инсоляции
            const result = this.calculator.calculatePoint(point, null, 120);
            const currentStatus = result ? result.evaluation.status : 'PASS';
            
            // Проверяем ухудшение
            if (this._isDegraded(baselineStatus, currentStatus)) {
                degradedCount++;
                for (const cell of blockingCells) {
                    violators.add(cell);
                }
            }
        }
        
        if (degradedCount > 0 || violators.size > 0) {
            console.log(`[SolarPotential] Затронуто: ${affectedPoints.length}, ухудшено: ${degradedCount}, виновников: ${violators.size}`);
        }
        
        return violators;
    }
    
    /**
     * Проверить ухудшение статуса
     */
    _isDegraded(before, after) {
        const order = { 'PASS': 0, 'WARNING': 1, 'FAIL': 2 };
        return (order[after] || 0) > (order[before] || 0);
    }
    
    /**
     * Финальная проверка — сколько точек ухудшились
     */
    _checkFinalViolations(existingPoints) {
        let violations = 0;
        
        for (let i = 0; i < existingPoints.length; i++) {
            const point = existingPoints[i];
            const baselineStatus = this.baselineStatus.get(i);
            
            const result = this.calculator.calculatePoint(point, null, 120);
            const currentStatus = result ? result.evaluation.status : 'PASS';
            
            if (this._isDegraded(baselineStatus, currentStatus)) {
                violations++;
                const mins = result?.evaluation?.totalMinutes || 0;
                console.log(`[SolarPotential] ФИНАЛ: Точка ${i} ухудшена ${baselineStatus}→${currentStatus} (${mins} мин)`);
            }
        }
        
        return violations;
    }
    
    /**
     * Создать финальный merged mesh
     */
    _createFinalMesh() {
        if (this.cells.length === 0) return;
        
        // Собираем все геометрии
        const geometries = [];
        
        for (const cell of this.cells) {
            // Пропускаем удалённые ячейки (height=0) и слишком низкие
            if (cell.height <= 0) continue;
            if (cell.height < this.minHeight) continue;
            
            const halfSize = this.cellSize / 2;
            const shape = new THREE.Shape();
            shape.moveTo(cell.x - halfSize, cell.y - halfSize);
            shape.lineTo(cell.x + halfSize, cell.y - halfSize);
            shape.lineTo(cell.x + halfSize, cell.y + halfSize);
            shape.lineTo(cell.x - halfSize, cell.y + halfSize);
            shape.closePath();
            
            const geom = new THREE.ExtrudeGeometry(shape, {
                depth: cell.height,
                bevelEnabled: false
            });
            
            geometries.push(geom);
        }
        
        if (geometries.length === 0) return;
        
        // Merge геометрий
        const merged = this._mergeGeometries(geometries);
        
        merged.computeBoundingBox();
        merged.computeBoundingSphere();
        
        // Освобождаем отдельные геометрии
        for (const g of geometries) g.dispose();
        
        // Материал
        const material = new THREE.MeshLambertMaterial({
            color: this.potentialColor,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: this.potentialOpacity
        });
        
        this.resultMesh = new THREE.Mesh(merged, material);
        
        this.resultMesh.userData = {
            id: `solar-potential-${Date.now()}`,
            type: 'building',
            subtype: 'solar-potential',
            properties: {
                height: Math.max(...this.cells.map(c => c.height)),
                isResidential: false
            }
        };
        
        this.resultMesh.updateMatrix();
        this.resultMesh.updateMatrixWorld(true);
        
        const group = this.sceneManager.getBuildingsGroup();
        group.add(this.resultMesh);
        
        console.log(`[SolarPotential] Финальный mesh создан`);
    }
    
    /**
     * Объединить геометрии в одну
     */
    _mergeGeometries(geometries) {
        let totalPositions = 0;
        let totalNormals = 0;
        let totalIndices = 0;
        
        for (const g of geometries) {
            totalPositions += g.attributes.position.count * 3;
            if (g.attributes.normal) totalNormals += g.attributes.normal.count * 3;
            if (g.index) totalIndices += g.index.count;
        }
        
        const positions = new Float32Array(totalPositions);
        const normals = new Float32Array(totalNormals);
        const indices = new Uint32Array(totalIndices);
        
        let posOffset = 0;
        let normOffset = 0;
        let idxOffset = 0;
        let vertexOffset = 0;
        
        for (const g of geometries) {
            const pos = g.attributes.position;
            const norm = g.attributes.normal;
            const idx = g.index;
            
            // Копируем позиции
            for (let i = 0; i < pos.count; i++) {
                positions[posOffset++] = pos.getX(i);
                positions[posOffset++] = pos.getY(i);
                positions[posOffset++] = pos.getZ(i);
            }
            
            // Копируем нормали
            if (norm) {
                for (let i = 0; i < norm.count; i++) {
                    normals[normOffset++] = norm.getX(i);
                    normals[normOffset++] = norm.getY(i);
                    normals[normOffset++] = norm.getZ(i);
                }
            }
            
            // Копируем индексы со смещением
            if (idx) {
                for (let i = 0; i < idx.count; i++) {
                    indices[idxOffset++] = idx.getX(i) + vertexOffset;
                }
            }
            
            vertexOffset += pos.count;
        }
        
        const merged = new THREE.BufferGeometry();
        merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        if (totalNormals > 0) {
            merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        }
        if (totalIndices > 0) {
            merged.setIndex(new THREE.BufferAttribute(indices, 1));
        }
        
        return merged;
    }
    
    /**
     * Точка в полигоне
     */
    _pointInPolygon(x, y, polygon) {
        let inside = false;
        
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x, yi = polygon[i].y;
            const xj = polygon[j].x, yj = polygon[j].y;
            
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        
        return inside;
    }
    
    /**
     * Статистика
     */
    _calculateStats() {
        const activeCubes = this.cubes.filter(c => !c.removed);
        
        let totalVolume = 0;
        let minZ = Infinity;
        let maxZ = -Infinity;
        
        for (const cube of activeCubes) {
            totalVolume += cube.size * cube.size * cube.size;
            minZ = Math.min(minZ, cube.z);
            maxZ = Math.max(maxZ, cube.z + cube.size);
        }
        
        // Площадь основания (уникальные X,Y позиции)
        const basePositions = new Set();
        for (const cube of activeCubes) {
            basePositions.add(`${cube.x},${cube.y}`);
        }
        const totalArea = basePositions.size * this.cellSize * this.cellSize;
        
        return {
            cellCount: activeCubes.length,
            totalArea: totalArea,
            totalVolume: totalVolume,
            minHeight: minZ === Infinity ? 0 : minZ,
            maxHeight: maxZ === -Infinity ? 0 : maxZ,
            avgHeight: activeCubes.length > 0 ? totalVolume / totalArea : 0
        };
    }
    
    /**
     * Очистить всё
     */
    clear() {
        this.cancel();
        this._clearTempMeshes();
        this._hideControlPanel();
        
        const group = this.sceneManager.getBuildingsGroup();
        
        if (this.resultMesh) {
            group.remove(this.resultMesh);
            
            // Очищаем контур
            if (this.edgesMesh) {
                if (this.edgesMesh.geometry) this.edgesMesh.geometry.dispose();
                if (this.edgesMesh.material) this.edgesMesh.material.dispose();
                this.edgesMesh = null;
            }
            
            if (this.resultMesh.geometry) this.resultMesh.geometry.dispose();
            if (this.resultMesh.material) this.resultMesh.material.dispose();
            this.resultMesh = null;
        }
        
        // Очищаем футпринт (он теперь отдельно в группе)
        if (this.groundOutline) {
            group.remove(this.groundOutline);
            if (this.groundOutline.geometry) this.groundOutline.geometry.dispose();
            if (this.groundOutline.material) this.groundOutline.material.dispose();
            this.groundOutline = null;
        }
        
        this.cells = [];
        this.cubes = [];
        this.gridPositions = [];
        this.ghostMode = false;
        this.isBlocked = false;
        this.isHidden = false;
        this.isFootprintHidden = false;
        this.isSelected = false;
        this.baselineStatus.clear();
        if (this.baselineMinutes) this.baselineMinutes.clear();
        this.meshToCellMap.clear();
        this._activeMeshesCache = null;
        this._activeMeshesDirty = true;
    }
    
    /**
     * Отмена расчёта
     */
    cancel() {
        this.isCancelled = true;
        this._hideProgress();
    }
    
    /**
     * Пауза
     */
    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export { SolarPotential };
window.SolarPotential = SolarPotential;