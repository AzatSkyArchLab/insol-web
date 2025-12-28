/**
 * ============================================
 * SolarPotential.js (Инсоляционная горка)
 * Расчёт инсоляционного потенциала территории
 * ============================================
 * 
 * Логика окрашивания:
 * - 🟢 Зелёный: не нарушает инсоляцию
 * - 🟡 Жёлтый: ухудшил PASS → WARNING (откат на шаг)
 * - 🔴 Красный: ухудшил до FAIL (откат на шаг)
 */

class SolarPotential {
    constructor(sceneManager, insolationCalculator, insolationGrid, options = {}) {
        this.sceneManager = sceneManager;
        this.scene = sceneManager.scene;
        this.calculator = insolationCalculator;
        this.insolationGrid = insolationGrid;
        
        // Параметры (по умолчанию)
        this.cellSize = options.cellSize || 12;
        this.heightStep = options.heightStep || 3;
        this.maxHeight = options.maxHeight || 75;
        this.animationDelay = options.animationDelay || 50;
        this.fastMode = options.fastMode !== undefined ? options.fastMode : false;
        
        // Цвета колонок
        this.colors = {
            safe: 0x4caf50,      // Зелёный
            warning: 0xffeb3b,   // Жёлтый
            fail: 0xf44336,      // Красный
            ghost: 0xffffff      // Белый (прозрачный режим)
        };
        this.defaultOpacity = 0.6;
        this.ghostOpacity = 0.25;
        
        // Данные
        this.columns = [];
        this.tempMeshes = [];
        this.resultMesh = null;
        this.groundOutline = null;
        this.controlPanel = null;
        this._localShape = null;  // Шаблон Shape для колонок
        
        // Состояния
        this.isHidden = false;
        this.isFootprintHidden = false;
        this.isSelected = false;
        this.isCalculating = false;
        this.isCancelled = false;
        this.isLocked = false;          // Блокировка от изменений
        this.isRayBlocked = false;      // Блокировка от лучей
        this.isGhostMode = false;       // Прозрачный режим
        
        // Сохранённые цвета для восстановления
        this.savedColors = new Map();
        
        // Baseline
        this.baselineStatus = new Map();
        this.previousStatus = new Map();  // Статус на предыдущем шаге
        
        // Кэш
        this.meshToColumnMap = new Map();
        
        // Raycaster
        this.raycaster = new THREE.Raycaster();
        this.raycaster.far = 500;
        
        // UI
        this.progressOverlay = null;
        this.settingsDialog = null;
        
        // Callbacks
        this.onProgress = options.onProgress || (() => {});
        this.onComplete = options.onComplete || (() => {});
        
        console.log('[SolarPotential] Инсоляционная горка создана');
    }
    
    /**
     * Показать диалог настроек
     */
    async showSettingsAndCalculate(polygonPoints) {
        return new Promise((resolve) => {
            // Удаляем старый диалог если есть
            if (this.settingsDialog) {
                this.settingsDialog.remove();
            }
            
            this.settingsDialog = document.createElement('div');
            this.settingsDialog.id = 'solar-potential-settings';
            this.settingsDialog.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                z-index: 10001;
                background: white;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                min-width: 280px;
            `;
            
            this.settingsDialog.innerHTML = `
                <div style="font-size: 16px; font-weight: 600; margin-bottom: 16px; color: #333;">
                    ⛰️ Инсоляционная горка
                </div>
                
                <div style="margin-bottom: 12px;">
                    <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">
                        Максимальная высота (м)
                    </label>
                    <input type="number" id="sp-max-height" value="${this.maxHeight}" min="3" max="500" 
                        style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                </div>
                
                <div style="margin-bottom: 12px;">
                    <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">
                        Размер ячейки (м): <span id="sp-cell-val">${this.cellSize}</span>
                    </label>
                    <input type="range" id="sp-cell-size" value="${this.cellSize}" min="3" max="24" step="3"
                        style="width: 100%;">
                </div>
                
                <div style="margin-bottom: 12px;">
                    <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">
                        Шаг по высоте (м): <span id="sp-step-val">${this.heightStep}</span>
                    </label>
                    <input type="range" id="sp-height-step" value="${this.heightStep}" min="1" max="6" step="1"
                        style="width: 100%;">
                </div>
                
                <div style="margin-bottom: 16px;">
                    <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: #333; cursor: pointer;">
                        <input type="checkbox" id="sp-fast-mode" ${this.fastMode ? 'checked' : ''}>
                        Быстрый режим (без анимации)
                    </label>
                </div>
                
                <div style="display: flex; gap: 8px; justify-content: flex-end;">
                    <button id="sp-cancel-btn" style="
                        padding: 8px 16px;
                        border: 1px solid #ddd;
                        background: white;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 13px;
                    ">Отмена</button>
                    <button id="sp-start-btn" style="
                        padding: 8px 16px;
                        border: none;
                        background: #4caf50;
                        color: white;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 13px;
                        font-weight: 500;
                    ">Построить</button>
                </div>
                
                <div style="margin-top: 12px; font-size: 10px; color: #888; text-align: center;">
                    🟢 безопасно &nbsp; 🟡 warning &nbsp; 🔴 fail
                </div>
            `;
            
            document.body.appendChild(this.settingsDialog);
            
            // Обновление значений слайдеров
            document.getElementById('sp-cell-size').oninput = (e) => {
                document.getElementById('sp-cell-val').textContent = e.target.value;
            };
            document.getElementById('sp-height-step').oninput = (e) => {
                document.getElementById('sp-step-val').textContent = e.target.value;
            };
            
            // Кнопка отмены
            document.getElementById('sp-cancel-btn').onclick = () => {
                this.settingsDialog.remove();
                this.settingsDialog = null;
                resolve(null);
            };
            
            // Кнопка старта
            document.getElementById('sp-start-btn').onclick = async () => {
                const maxHeight = parseInt(document.getElementById('sp-max-height').value, 10);
                const cellSize = parseInt(document.getElementById('sp-cell-size').value, 10);
                const heightStep = parseInt(document.getElementById('sp-height-step').value, 10);
                const fastMode = document.getElementById('sp-fast-mode').checked;
                
                if (isNaN(maxHeight) || maxHeight < 3 || maxHeight > 500) {
                    alert('Высота должна быть от 3 до 500 м');
                    return;
                }
                
                this.maxHeight = maxHeight;
                this.cellSize = cellSize;
                this.heightStep = heightStep;
                this.fastMode = fastMode;
                
                this.settingsDialog.remove();
                this.settingsDialog = null;
                
                const result = await this.calculate(polygonPoints);
                resolve(result);
            };
            
            // Фокус на поле высоты
            document.getElementById('sp-max-height').focus();
            document.getElementById('sp-max-height').select();
        });
    }
    
    /**
     * Основной расчёт
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
        console.log(`[SolarPotential] Старт. Точек: ${existingPoints.length}, макс: ${this.maxHeight}м, ячейка: ${this.cellSize}м, шаг: ${this.heightStep}м`);
        
        this._showProgress(0, 'Инициализация...');
        
        this._cacheNormalizedSunVectors();
        this._saveBaseline(existingPoints);
        
        await this._sleep(10);
        
        this._createColumns(polygonPoints);
        
        if (this.columns.length === 0) {
            this._hideProgress();
            this.isCalculating = false;
            alert('Не удалось создать сетку');
            return null;
        }
        
        console.log(`[SolarPotential] Создано ${this.columns.length} колонок`);
        this._showProgress(5, `${this.columns.length} колонок...`);
        
        await this._sleep(10);
        
        await this._growColumns(existingPoints);
        
        if (this.isCancelled) {
            this._clearTempMeshes();
            this._hideProgress();
            this.isCalculating = false;
            return null;
        }
        
        this._showProgress(95, 'Создание результата...');
        this._createFinalResult();
        
        const stats = this._calculateStats();
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
        
        this._hideProgress();
        this._showControlPanel();
        
        console.log(`[SolarPotential] Готово за ${elapsed}с! Объём: ${stats.totalVolume.toFixed(0)} м³`);
        
        this.isCalculating = false;
        this.onComplete(stats);
        
        return stats;
    }
    
    /**
     * Создать колонки как полноценные здания (ExtrudeGeometry)
     */
    _createColumns(polygonPoints) {
        this.columns = [];
        this._clearTempMeshes();
        
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        
        for (const p of polygonPoints) {
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
        }
        
        const halfCell = this.cellSize / 2;
        const group = this.sceneManager.getBuildingsGroup();
        
        // Shape в ЛОКАЛЬНЫХ координатах (центр в 0,0)
        const localShape = new THREE.Shape();
        localShape.moveTo(-halfCell, -halfCell);
        localShape.lineTo(halfCell, -halfCell);
        localShape.lineTo(halfCell, halfCell);
        localShape.lineTo(-halfCell, halfCell);
        localShape.closePath();
        
        let index = 0;
        
        for (let x = minX + halfCell; x < maxX; x += this.cellSize) {
            for (let y = minY + halfCell; y < maxY; y += this.cellSize) {
                if (this._pointInPolygon(x, y, polygonPoints)) {
                    
                    const column = {
                        x: x,
                        y: y,
                        height: 0,
                        stopped: false,
                        violationType: null,
                        mesh: null,
                        index: index++
                    };
                    
                    // Начальная геометрия (невидимая, height=0.01)
                    const geometry = new THREE.ExtrudeGeometry(localShape, {
                        depth: 0.01,
                        bevelEnabled: false
                    });
                    geometry.computeBoundingBox();
                    geometry.computeBoundingSphere();
                    
                    const material = new THREE.MeshLambertMaterial({
                        color: this.colors.safe,
                        transparent: true,
                        opacity: this.defaultOpacity,
                        side: THREE.DoubleSide
                    });
                    
                    const mesh = new THREE.Mesh(geometry, material);
                    
                    // Позиция в мировых координатах
                    mesh.position.set(x, y, 0);
                    mesh.visible = false;
                    
                    // Полноценные userData как у здания
                    mesh.userData = {
                        id: `hill-col-${column.index}-${Date.now()}`,
                        type: 'building',
                        subtype: 'solar-potential-column',
                        properties: {
                            height: 0,
                            heightSource: 'generated',
                            isResidential: false,
                            buildingType: 'solar-potential'
                        }
                    };
                    
                    mesh.updateMatrix();
                    mesh.updateMatrixWorld(true);
                    
                    group.add(mesh);
                    this.tempMeshes.push(mesh);
                    column.mesh = mesh;
                    this.meshToColumnMap.set(mesh, column);
                    
                    this.columns.push(column);
                }
            }
        }
        
        // Сохраняем шаблон Shape для пересоздания геометрии
        this._localShape = localShape;
    }
    
    /**
     * Растить колонки шаг за шагом
     * 
     * Алгоритм:
     * 1. Увеличиваем высоту колонок на шаг
     * 2. Проверяем инсоляцию точек
     * 3. Сравниваем с ПРЕДЫДУЩИМ шагом (не с baseline!)
     * 4. Если ухудшилось → откат + окраска
     */
    async _growColumns(existingPoints) {
        const sunVectors = this.normalizedSunVectors;
        const totalSteps = Math.ceil(this.maxHeight / this.heightStep);
        
        // Все точки для проверки (кроме изначально FAIL - их уже нельзя ухудшить)
        const checkPoints = [];
        for (let i = 0; i < existingPoints.length; i++) {
            const status = this.baselineStatus.get(i);
            if (status !== 'FAIL') {
                checkPoints.push({ index: i, point: existingPoints[i] });
            }
        }
        
        console.log(`[SolarPotential] Проверяем ${checkPoints.length} точек`);
        
        // Текущий статус точек (обновляется на каждом шаге)
        // Инициализируем = baseline
        this.previousStatus = new Map();
        for (const { index } of checkPoints) {
            this.previousStatus.set(index, this.baselineStatus.get(index));
        }
        
        let step = 0;
        
        while (!this.isCancelled && step < totalSteps) {
            step++;
            const targetHeight = step * this.heightStep;
            
            // ШАГ 1: Увеличиваем высоту всех активных колонок
            let activeCount = 0;
            for (const col of this.columns) {
                if (!col.stopped) {
                    col.height = Math.min(targetHeight, this.maxHeight);
                    this._updateColumnMesh(col);
                    activeCount++;
                }
            }
            
            if (activeCount === 0) break;
            
            // Прогресс
            const progress = 5 + (step / totalSteps) * 85;
            this._showProgress(progress, `Высота: ${targetHeight}м (${activeCount} растут)`);
            
            // Анимация
            if (!this.fastMode) {
                await this._sleep(this.animationDelay);
            }
            
            // ШАГ 2: Проверяем и сравниваем с ПРЕДЫДУЩИМ шагом
            await this._checkAndRollback(checkPoints, sunVectors, targetHeight);
        }
        
        console.log(`[SolarPotential] Рост завершён. Шагов: ${step}`);
    }
    
    /**
     * Обновить меш колонки - пересоздаём геометрию с новой высотой
     */
    _updateColumnMesh(column) {
        const mesh = column.mesh;
        if (!mesh || !this._localShape) return;
        
        if (column.height <= 0) {
            mesh.visible = false;
            mesh.userData.properties.height = 0;
            return;
        }
        
        // Пересоздаём геометрию с новой высотой
        const oldGeometry = mesh.geometry;
        
        const newGeometry = new THREE.ExtrudeGeometry(this._localShape, {
            depth: column.height,
            bevelEnabled: false
        });
        
        // ВАЖНО: пересчитываем bounding для raycast
        newGeometry.computeBoundingBox();
        newGeometry.computeBoundingSphere();
        
        mesh.geometry = newGeometry;
        oldGeometry.dispose();
        
        mesh.visible = true;
        mesh.userData.properties.height = column.height;
        
        // ВАЖНО: обновляем матрицы для корректного raycast
        mesh.updateMatrix();
        mesh.updateMatrixWorld(true);
    }
    
    /**
     * Проверить точки и откатить виновников
     * Сравниваем с состоянием на ПРЕДЫДУЩЕМ шаге
     */
    async _checkAndRollback(checkPoints, sunVectors, targetHeight) {
        const activeMeshes = this.tempMeshes.filter(m => m.visible);
        if (activeMeshes.length === 0) return;
        
        // Сбрасываем кэш перед проверкой
        this.calculator.invalidateObstaclesCache();
        
        // Собираем нарушения и новые статусы
        const violations = [];
        const newStatuses = new Map();
        
        let isFirst = true;
        for (const { index, point } of checkPoints) {
            const prevStatus = this.previousStatus.get(index);
            
            // Рассчитываем новый статус
            const result = this.calculator.calculatePoint(point, null, 120, isFirst);
            isFirst = false;
            
            const newStatus = result ? result.evaluation.status : 'PASS';
            newStatuses.set(index, newStatus);
            
            // Проверяем ухудшение относительно ПРЕДЫДУЩЕГО шага
            const degradation = this._getDegradationType(prevStatus, newStatus);
            
            if (degradation) {
                violations.push({
                    index,
                    point,
                    prevStatus,
                    newStatus,
                    degradation
                });
            }
        }
        
        if (violations.length === 0) {
            // Нет нарушений - обновляем previousStatus для следующего шага
            for (const [idx, status] of newStatuses) {
                this.previousStatus.set(idx, status);
            }
            return;
        }
        
        console.log(`[SolarPotential] Шаг ${targetHeight}м: ${violations.length} нарушений`);
        
        // Находим виновные колонки
        const blockersToRollback = new Map();
        
        for (const v of violations) {
            const blocker = this._findBlockingColumn(v.point, sunVectors, activeMeshes);
            
            if (blocker && !blocker.stopped) {
                const existing = blockersToRollback.get(blocker);
                // Сохраняем худший тип (fail > warning)
                if (!existing || v.degradation === 'fail') {
                    blockersToRollback.set(blocker, v);
                }
            }
        }
        
        // Откатываем виновников
        for (const [blocker, violation] of blockersToRollback) {
            const badHeight = blocker.height;
            
            // ОТКАТ на шаг назад
            blocker.height = Math.max(0, blocker.height - this.heightStep);
            blocker.stopped = true;
            
            // Окрашиваем в цвет ухудшения
            if (violation.degradation === 'fail') {
                blocker.violationType = 'fail';
                this._setColumnColor(blocker, this.colors.fail);
            } else {
                blocker.violationType = 'warning';
                this._setColumnColor(blocker, this.colors.warning);
            }
            
            this._updateColumnMesh(blocker);
            
            console.log(`[SolarPotential] Колонка ${blocker.index}: ${violation.prevStatus}→${violation.newStatus} на ${badHeight}м, откат до ${blocker.height}м (${violation.degradation})`);
        }
        
        // Сбрасываем кэш после откатов
        if (blockersToRollback.size > 0) {
            this.calculator.invalidateObstaclesCache();
        }
        
        // Обновляем previousStatus только для точек БЕЗ нарушений
        // (для точек с нарушениями колонка откачена, статус вернётся к предыдущему)
        const violationIndices = new Set(violations.map(v => v.index));
        for (const [idx, status] of newStatuses) {
            if (!violationIndices.has(idx)) {
                this.previousStatus.set(idx, status);
            }
        }
    }
    
    /**
     * Определить тип деградации инсоляции
     * 
     * @param {string} before - статус на ПРЕДЫДУЩЕМ шаге
     * @param {string} after - статус на ТЕКУЩЕМ шаге (после роста колонки)
     * @returns {string|null} 'fail', 'warning' или null
     * 
     * Варианты:
     * - PASS → WARNING = 'warning' (жёлтый)
     * - PASS → FAIL = 'fail' (красный)
     * - WARNING → FAIL = 'fail' (красный)
     * - без изменений или улучшение = null
     */
    _getDegradationType(before, after) {
        // Любое ухудшение до FAIL = красный
        if (after === 'FAIL' && before !== 'FAIL') return 'fail';
        // PASS → WARNING = жёлтый
        if (before === 'PASS' && after === 'WARNING') return 'warning';
        // Нет ухудшения
        return null;
    }
    
    _setColumnColor(column, color) {
        if (column.mesh && column.mesh.material) {
            column.mesh.material.color.setHex(color);
            column.mesh.material.needsUpdate = true;
        }
    }
    
    _findBlockingColumn(point, sunVectors, activeMeshes) {
        const pos = point.position;
        
        for (const dir of sunVectors) {
            this.raycaster.set(pos, dir);
            const hits = this.raycaster.intersectObjects(activeMeshes, false);
            
            // Ищем первое пересечение с КОЛОНКОЙ (не с другим зданием)
            for (const hit of hits) {
                if (hit.distance > 0.5) {
                    const column = this.meshToColumnMap.get(hit.object);
                    if (column) {
                        return column;
                    }
                }
            }
        }
        
        return null;
    }
    
    /**
     * Создать финальный результат - контур и статистика
     * Колонки уже являются полноценными зданиями
     */
    _createFinalResult() {
        const activeColumns = this.columns.filter(c => c.height > 0);
        
        if (activeColumns.length === 0) {
            console.log('[SolarPotential] Нет активных колонок');
            return;
        }
        
        // Контур на земле
        this._createGroundOutline(activeColumns);
        
        // Статистика
        const safe = activeColumns.filter(c => !c.violationType).length;
        const warning = activeColumns.filter(c => c.violationType === 'warning').length;
        const fail = activeColumns.filter(c => c.violationType === 'fail').length;
        
        console.log(`[SolarPotential] Колонки-здания: 🟢${safe} 🟡${warning} 🔴${fail}`);
    }
    
    _createGroundOutline(columns) {
        if (!columns || columns.length === 0) return;
        
        const halfSize = this.cellSize / 2;
        const edges = new Set();
        
        for (const col of columns) {
            const corners = [
                [col.x - halfSize, col.y - halfSize],
                [col.x + halfSize, col.y - halfSize],
                [col.x + halfSize, col.y + halfSize],
                [col.x - halfSize, col.y + halfSize]
            ];
            
            for (let i = 0; i < 4; i++) {
                const a = corners[i];
                const b = corners[(i + 1) % 4];
                
                const edgeKey = [a, b].sort((p1, p2) => p1[0] - p2[0] || p1[1] - p2[1])
                    .map(p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('|');
                
                if (edges.has(edgeKey)) {
                    edges.delete(edgeKey);
                } else {
                    edges.add(edgeKey);
                }
            }
        }
        
        const positions = [];
        for (const edgeKey of edges) {
            const [p1, p2] = edgeKey.split('|').map(s => s.split(',').map(Number));
            positions.push(p1[0], p1[1], 0.1);
            positions.push(p2[0], p2[1], 0.1);
        }
        
        if (positions.length === 0) return;
        
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        
        const material = new THREE.LineBasicMaterial({ color: 0x333333, linewidth: 2 });
        
        this.groundOutline = new THREE.LineSegments(geometry, material);
        this.groundOutline.userData = { subtype: 'solar-potential-footprint' };
        
        const group = this.sceneManager.getBuildingsGroup();
        group.add(this.groundOutline);
    }
    
    // ===== ПРОГРЕСС =====
    
    _showProgress(percent, text) {
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
            this.progressOverlay.id = 'solar-potential-progress';
            this.progressOverlay.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 10000;
                background: white;
                padding: 12px 16px;
                border-radius: 8px;
                box-shadow: 0 2px 12px rgba(0,0,0,0.2);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 13px;
                min-width: 280px;
            `;
            document.body.appendChild(this.progressOverlay);
        }
        
        this.progressOverlay.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                <div style="
                    width: 18px;
                    height: 18px;
                    border: 2px solid #e5e5e5;
                    border-top-color: #4caf50;
                    border-radius: 50%;
                    animation: solar-potential-spin 0.8s linear infinite;
                "></div>
                <span style="color: #333; font-weight: 500;">Инсоляционная горка</span>
                <button id="sp-cancel" style="
                    margin-left: auto;
                    background: none;
                    border: none;
                    color: #999;
                    cursor: pointer;
                    font-size: 18px;
                ">×</button>
            </div>
            <div style="background: #eee; border-radius: 4px; height: 6px; overflow: hidden;">
                <div style="background: linear-gradient(90deg, #4caf50, #ffeb3b, #f44336); height: 100%; width: ${percent}%; transition: width 0.3s;"></div>
            </div>
            <div style="margin-top: 6px; color: #666; font-size: 11px;">
                ${text || `${percent.toFixed(0)}%`}
            </div>
        `;
        
        const cancelBtn = document.getElementById('sp-cancel');
        if (cancelBtn) {
            cancelBtn.onclick = () => this.cancel();
        }
    }
    
    _hideProgress() {
        if (this.progressOverlay) {
            this.progressOverlay.remove();
            this.progressOverlay = null;
        }
    }
    
    // ===== ПАНЕЛЬ УПРАВЛЕНИЯ =====
    
    _showControlPanel() {
        this._hideControlPanel();
        
        const potentialBtn = document.querySelector('[data-tool="potential"]');
        
        this.controlPanel = document.createElement('div');
        this.controlPanel.id = 'solar-potential-panel';
        
        const posStyle = potentialBtn 
            ? `top: ${potentialBtn.getBoundingClientRect().bottom + 8}px; left: ${potentialBtn.getBoundingClientRect().left}px;`
            : `top: 60px; left: 400px;`;
        
        this.controlPanel.style.cssText = `
            position: fixed;
            ${posStyle}
            z-index: 9999;
            background: white;
            padding: 12px;
            border-radius: 6px;
            box-shadow: 0 0 0 1px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.15);
            font-family: -apple-system, sans-serif;
            font-size: 11px;
            min-width: 180px;
        `;
        
        const stats = this._calculateStats();
        
        this.controlPanel.innerHTML = `
            <div style="font-weight: 600; margin-bottom: 10px; color: #333; display: flex; align-items: center;">
                ⛰️ Инсоляционная горка
                <button id="sp-close" style="margin-left: auto; background: none; border: none; cursor: pointer; color: #999; font-size: 16px;">×</button>
            </div>
            <div style="font-size: 10px; color: #666; margin-bottom: 8px;">
                🟢 ${stats.safeCount} &nbsp; 🟡 ${stats.warningCount} &nbsp; 🔴 ${stats.failCount}
            </div>
            <div style="font-size: 10px; color: #666; margin-bottom: 10px;">
                Объём: ${stats.totalVolume.toFixed(0)} м³ | Макс: ${stats.maxHeight}м
            </div>
            <div style="display: flex; flex-direction: column; gap: 6px;">
                <button id="sp-lock" class="sp-btn ${this.isLocked ? 'active' : ''}">
                    ${this.isLocked ? '🔒 Заблокировано' : '🔓 Разблокировано'}
                </button>
                <button id="sp-ray-block" class="sp-btn ${this.isRayBlocked ? 'active' : ''}">
                    ${this.isRayBlocked ? '🚫 Лучи: выкл' : '☀️ Лучи: вкл'}
                </button>
                <button id="sp-ghost" class="sp-btn ${this.isGhostMode ? 'active' : ''}">
                    ${this.isGhostMode ? '👻 Прозрачный' : '🎨 Цветной'}
                </button>
                <button id="sp-visibility" class="sp-btn ${this.isHidden ? 'active' : ''}">
                    ${this.isHidden ? '👁‍🗨 Скрыт' : '👁 Видимый'}
                </button>
                <button id="sp-footprint" class="sp-btn ${this.isFootprintHidden ? 'active' : ''}">
                    ${this.isFootprintHidden ? '⬡ Футпринт скрыт' : '⬡ Футпринт'}
                </button>
                <hr style="border: none; border-top: 1px solid #eee; margin: 4px 0;">
                <button id="sp-clear" class="sp-btn" style="color: #d32f2f;">🗑 Удалить</button>
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
                .sp-btn:hover { background: #eee; }
                .sp-btn.active { background: #e3f2fd; border-color: #90caf9; color: #1976d2; }
            </style>
        `;
        
        document.body.appendChild(this.controlPanel);
        
        // Обработчики
        document.getElementById('sp-close').onclick = () => this._hideControlPanel();
        document.getElementById('sp-lock').onclick = () => { this.toggleLock(); this._updateControlPanel(); };
        document.getElementById('sp-ray-block').onclick = () => { this.toggleRayBlock(); this._updateControlPanel(); };
        document.getElementById('sp-ghost').onclick = () => { this.toggleGhostMode(); this._updateControlPanel(); };
        document.getElementById('sp-visibility').onclick = () => { this.toggleVisibility(); this._updateControlPanel(); };
        document.getElementById('sp-footprint').onclick = () => { this.toggleFootprint(); this._updateControlPanel(); };
        document.getElementById('sp-clear').onclick = () => { this.clear(); };
    }
    
    _updateControlPanel() {
        if (!this.controlPanel) return;
        
        const lockBtn = document.getElementById('sp-lock');
        const rayBtn = document.getElementById('sp-ray-block');
        const ghostBtn = document.getElementById('sp-ghost');
        const visBtn = document.getElementById('sp-visibility');
        const footBtn = document.getElementById('sp-footprint');
        
        if (lockBtn) {
            lockBtn.textContent = this.isLocked ? '🔒 Заблокировано' : '🔓 Разблокировано';
            lockBtn.classList.toggle('active', this.isLocked);
        }
        if (rayBtn) {
            rayBtn.textContent = this.isRayBlocked ? '🚫 Лучи: выкл' : '☀️ Лучи: вкл';
            rayBtn.classList.toggle('active', this.isRayBlocked);
        }
        if (ghostBtn) {
            ghostBtn.textContent = this.isGhostMode ? '👻 Прозрачный' : '🎨 Цветной';
            ghostBtn.classList.toggle('active', this.isGhostMode);
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
    
    _hideControlPanel() {
        if (this.controlPanel) {
            this.controlPanel.remove();
            this.controlPanel = null;
        }
    }
    
    showPanel() { if (this.columns.length > 0) this._showControlPanel(); }
    hidePanel() { this._hideControlPanel(); }
    
    // ===== БЛОКИРОВКИ И РЕЖИМЫ =====
    
    /**
     * Блокировка от изменений/перемещений
     */
    toggleLock() {
        this.isLocked = !this.isLocked;
        console.log(`[SolarPotential] Блокировка: ${this.isLocked ? 'вкл' : 'выкл'}`);
        return this.isLocked;
    }
    
    /**
     * Блокировка от лучей (не участвует в расчёте инсоляции)
     */
    toggleRayBlock() {
        this.isRayBlocked = !this.isRayBlocked;
        
        // Меняем тип для raycast
        const newType = this.isRayBlocked ? 'ghost' : 'building';
        
        for (const col of this.columns) {
            if (col.mesh) {
                col.mesh.userData.type = newType;
            }
        }
        
        // Сбрасываем кэш
        if (this.calculator) {
            this.calculator.invalidateObstaclesCache();
        }
        
        console.log(`[SolarPotential] Блокировка лучей: ${this.isRayBlocked ? 'вкл' : 'выкл'}`);
        return this.isRayBlocked;
    }
    
    /**
     * Прозрачный режим (белый полупрозрачный)
     */
    toggleGhostMode() {
        this.isGhostMode = !this.isGhostMode;
        
        if (this.isGhostMode) {
            // Сохраняем цвета и делаем прозрачными
            for (const col of this.columns) {
                if (col.mesh && col.mesh.material) {
                    this.savedColors.set(col.index, col.mesh.material.color.getHex());
                    col.mesh.material.color.setHex(this.colors.ghost);
                    col.mesh.material.opacity = this.ghostOpacity;
                    col.mesh.material.needsUpdate = true;
                }
            }
        } else {
            // Восстанавливаем цвета
            for (const col of this.columns) {
                if (col.mesh && col.mesh.material) {
                    const savedColor = this.savedColors.get(col.index);
                    if (savedColor !== undefined) {
                        col.mesh.material.color.setHex(savedColor);
                    } else {
                        // Цвет по типу нарушения
                        if (col.violationType === 'fail') {
                            col.mesh.material.color.setHex(this.colors.fail);
                        } else if (col.violationType === 'warning') {
                            col.mesh.material.color.setHex(this.colors.warning);
                        } else {
                            col.mesh.material.color.setHex(this.colors.safe);
                        }
                    }
                    col.mesh.material.opacity = this.defaultOpacity;
                    col.mesh.material.needsUpdate = true;
                }
            }
        }
        
        console.log(`[SolarPotential] Прозрачный режим: ${this.isGhostMode ? 'вкл' : 'выкл'}`);
        return this.isGhostMode;
    }
    
    // ===== ВЫДЕЛЕНИЕ =====
    
    select() {
        if (this.isSelected) return;
        this.isSelected = true;
        
        for (const col of this.columns) {
            if (col.mesh && col.mesh.material) {
                col.mesh.material.opacity = 0.8;
                col.mesh.material.needsUpdate = true;
            }
        }
    }
    
    deselect() {
        if (!this.isSelected) return;
        this.isSelected = false;
        
        const opacity = this.isGhostMode ? this.ghostOpacity : this.defaultOpacity;
        
        for (const col of this.columns) {
            if (col.mesh && col.mesh.material) {
                col.mesh.material.opacity = opacity;
                col.mesh.material.needsUpdate = true;
            }
        }
    }
    
    // ===== ВИДИМОСТЬ =====
    
    hide() {
        this.isHidden = true;
        for (const col of this.columns) {
            if (col.mesh) col.mesh.visible = false;
        }
        if (this.groundOutline) this.groundOutline.visible = false;
    }
    
    show() {
        this.isHidden = false;
        for (const col of this.columns) {
            if (col.mesh && col.height > 0) col.mesh.visible = true;
        }
        if (this.groundOutline && !this.isFootprintHidden) this.groundOutline.visible = true;
    }
    
    toggleVisibility() {
        if (this.isHidden) this.show();
        else this.hide();
        return !this.isHidden;
    }
    
    hideFootprint() {
        this.isFootprintHidden = true;
        if (this.groundOutline) this.groundOutline.visible = false;
    }
    
    showFootprint() {
        this.isFootprintHidden = false;
        if (this.groundOutline) this.groundOutline.visible = true;
    }
    
    toggleFootprint() {
        if (this.isFootprintHidden) this.showFootprint();
        else this.hideFootprint();
        return !this.isFootprintHidden;
    }
    
    // ===== ВСПОМОГАТЕЛЬНЫЕ =====
    
    _cacheNormalizedSunVectors() {
        this.normalizedSunVectors = this.calculator.sunVectors.map(sv =>
            new THREE.Vector3(sv.x, sv.y, sv.z).normalize()
        );
    }
    
    _saveBaseline(existingPoints) {
        this.baselineStatus.clear();
        
        let pass = 0, warn = 0, fail = 0;
        
        for (let i = 0; i < existingPoints.length; i++) {
            const result = this.calculator.calculatePoint(existingPoints[i], null, 120);
            const status = result ? result.evaluation.status : 'PASS';
            
            this.baselineStatus.set(i, status);
            
            if (status === 'PASS') pass++;
            else if (status === 'WARNING') warn++;
            else fail++;
        }
        
        console.log(`[SolarPotential] Baseline: 🟢${pass} 🟡${warn} 🔴${fail}`);
    }
    
    _getExistingBuildingPoints() {
        if (!this.insolationGrid) return [];
        
        const activeMesh = this.insolationGrid.getActiveMesh();
        if (activeMesh?.userData?.subtype?.includes('solar-potential')) {
            return [];
        }
        
        return this.insolationGrid.getCalculationPoints();
    }
    
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
    
    _mergeGeometries(geometries) {
        let totalPositions = 0;
        let totalIndices = 0;
        
        for (const g of geometries) {
            totalPositions += g.attributes.position.count * 3;
            if (g.index) totalIndices += g.index.count;
        }
        
        const positions = new Float32Array(totalPositions);
        const indices = new Uint32Array(totalIndices);
        
        let posOffset = 0, idxOffset = 0, vertexOffset = 0;
        
        for (const g of geometries) {
            const pos = g.attributes.position;
            const idx = g.index;
            
            for (let i = 0; i < pos.count; i++) {
                positions[posOffset++] = pos.getX(i);
                positions[posOffset++] = pos.getY(i);
                positions[posOffset++] = pos.getZ(i);
            }
            
            if (idx) {
                for (let i = 0; i < idx.count; i++) {
                    indices[idxOffset++] = idx.getX(i) + vertexOffset;
                }
            }
            
            vertexOffset += pos.count;
        }
        
        const merged = new THREE.BufferGeometry();
        merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        if (totalIndices > 0) merged.setIndex(new THREE.BufferAttribute(indices, 1));
        
        return merged;
    }
    
    _calculateStats() {
        const active = this.columns.filter(c => c.height > 0 && c.mesh);
        
        let totalVolume = 0;
        let maxHeight = 0;
        let safeCount = 0;
        let warningCount = 0;
        let failCount = 0;
        
        for (const col of active) {
            // Берём актуальную высоту из mesh (может быть изменена через HeightEditor)
            const height = col.mesh?.userData?.properties?.height || col.height;
            
            totalVolume += this.cellSize * this.cellSize * height;
            maxHeight = Math.max(maxHeight, height);
            
            if (col.violationType === 'fail') failCount++;
            else if (col.violationType === 'warning') warningCount++;
            else safeCount++;
        }
        
        return {
            columnCount: active.length,
            safeCount,
            warningCount,
            failCount,
            totalArea: active.length * this.cellSize * this.cellSize,
            totalVolume: totalVolume,
            maxHeight: maxHeight,
            avgHeight: active.length > 0 ? totalVolume / (active.length * this.cellSize * this.cellSize) : 0
        };
    }
    
    _clearTempMeshes() {
        const group = this.sceneManager.getBuildingsGroup();
        
        for (const mesh of this.tempMeshes) {
            group.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) mesh.material.dispose();
        }
        
        this.tempMeshes = [];
        this.meshToColumnMap.clear();
        this.savedColors.clear();
    }
    
    clear() {
        this.cancel();
        this._clearTempMeshes();
        this._hideControlPanel();
        
        const group = this.sceneManager.getBuildingsGroup();
        
        if (this.groundOutline) {
            group.remove(this.groundOutline);
            this.groundOutline.geometry?.dispose();
            this.groundOutline.material?.dispose();
            this.groundOutline = null;
        }
        
        this.columns = [];
        this._localShape = null;
        this.baselineStatus.clear();
        this.previousStatus.clear();
        this.isLocked = false;
        this.isRayBlocked = false;
        this.isGhostMode = false;
        this.isHidden = false;
        this.isFootprintHidden = false;
        
        if (this.calculator) {
            this.calculator.invalidateObstaclesCache();
        }
    }
    
    cancel() {
        this.isCancelled = true;
        this._hideProgress();
        if (this.settingsDialog) {
            this.settingsDialog.remove();
            this.settingsDialog = null;
        }
    }
    
    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export { SolarPotential };
window.SolarPotential = SolarPotential;