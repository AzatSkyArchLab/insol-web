/**
 * ============================================
 * SolarPotential.js (Инсоляционная горка)
 * v5: Clipping ячеек, клик на горку, draggable панель
 * ============================================
 */

class SolarPotential {
    constructor(sceneManager, insolationCalculator, insolationGrid, options = {}) {
        this.sceneManager = sceneManager;
        this.scene = sceneManager.scene;
        this.calculator = insolationCalculator;
        this.insolationGrid = insolationGrid;
        
        this.cellSize = options.cellSize || 12;
        this.heightStep = options.heightStep || 3;
        this.maxHeight = options.maxHeight || 75;
        this.gridAngle = options.gridAngle || 0;
        this.animationDelay = options.animationDelay || 50;
        this.fastMode = options.fastMode !== undefined ? options.fastMode : false;
        
        this.colors = {
            safe: 0x4caf50,
            warning: 0xffeb3b,
            fail: 0xf44336,
            ghost: 0xffffff
        };
        this.defaultOpacity = 0.6;
        this.ghostOpacity = 0.25;
        
        this.columns = [];
        this.tempMeshes = [];
        this.groundOutline = null;
        this.controlPanel = null;
        this._originalPolygon = null;
        
        this._previewGroup = null;
        this._previewPolygon = null;
        
        this.isHidden = false;
        this.isFootprintHidden = false;
        this.isSelected = false;
        this.isCalculating = false;
        this.isCancelled = false;
        this.isLocked = false;
        this.isRayBlocked = false;
        this.isGhostMode = false;
        
        this.isFinalized = false;
        this.envelopeData = null;
        this.topSurfaceMesh = null;
        this.topSurfaceWireframe = null;
        this.groundHeightGrid = null;
        this.groundHeightLabels = null;
        this._envelopeOrigin = null;
        
        this.savedColors = new Map();
        this.baselineStatus = new Map();
        this.previousStatus = new Map();
        this.meshToColumnMap = new Map();
        
        this.raycaster = new THREE.Raycaster();
        this.raycaster.far = 500;
        
        this.progressOverlay = null;
        this.settingsDialog = null;
        
        this.onProgress = options.onProgress || (() => {});
        this.onComplete = options.onComplete || (() => {});
        
        console.log('[SolarPotential] Создан');
    }
    
    /**
     * Проверка клика на горку
     */
    handleClick(mesh) {
        if (!mesh) return false;
        
        // Проверяем финализированные меши
        if (this.isFinalized) {
            if (mesh === this.topSurfaceMesh || 
                mesh === this.topSurfaceWireframe ||
                (this.groundHeightGrid && this.groundHeightGrid.children.includes(mesh))) {
                this._showControlPanel();
                return true;
            }
        }
        
        // Проверяем колонки
        if (this.meshToColumnMap.has(mesh)) {
            this._showControlPanel();
            return true;
        }
        
        return false;
    }
    
    /**
     * Проверка принадлежности меша к горке
     */
    belongsToHill(mesh) {
        if (!mesh) return false;
        
        if (mesh === this.topSurfaceMesh || 
            mesh === this.topSurfaceWireframe ||
            mesh === this.groundOutline) {
            return true;
        }
        
        if (this.groundHeightGrid && this.groundHeightGrid.children) {
            for (const child of this.groundHeightGrid.children) {
                if (child === mesh) return true;
            }
        }
        
        if (this.meshToColumnMap.has(mesh)) return true;
        
        return false;
    }
    
    /**
     * Диалог настроек с превью
     */
    async showSettingsAndCalculate(polygonPoints) {
        return new Promise((resolve) => {
            if (this.settingsDialog) {
                this.settingsDialog.remove();
            }
            
            this._previewPolygon = polygonPoints;
            this._updateGridPreview(polygonPoints, this.cellSize, this.gridAngle);
            
            this.settingsDialog = document.createElement('div');
            this.settingsDialog.id = 'solar-potential-settings';
            this.settingsDialog.style.cssText = `
                position: fixed;
                top: 100px;
                left: 100px;
                z-index: 10001;
                background: white;
                padding: 0;
                border-radius: 8px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                min-width: 320px;
                user-select: none;
            `;
            
            this.settingsDialog.innerHTML = `
                <div id="sp-dialog-header" style="
                    padding: 12px 16px;
                    background: #f5f5f5;
                    border-radius: 8px 8px 0 0;
                    cursor: move;
                    display: flex;
                    align-items: center;
                    border-bottom: 1px solid #e0e0e0;
                ">
                    <span style="font-size: 16px; font-weight: 600; color: #333;">⛰️ Инсоляционная горка</span>
                    <button id="sp-dialog-close" style="
                        margin-left: auto;
                        background: none;
                        border: none;
                        font-size: 20px;
                        cursor: pointer;
                        color: #999;
                        padding: 0 4px;
                    ">×</button>
                </div>
                
                <div style="padding: 16px;">
                    <div style="margin-bottom: 12px;">
                        <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">
                            Максимальная высота (м)
                        </label>
                        <input type="number" id="sp-max-height" value="${this.maxHeight}" min="3" max="500" 
                            style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; box-sizing: border-box;">
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
                    
                    <div style="margin-bottom: 12px; padding: 12px; background: #f8f9fa; border-radius: 6px;">
                        <label style="display: block; font-size: 12px; color: #666; margin-bottom: 6px;">
                            🔄 Угол сетки: <span id="sp-angle-val" style="font-weight: 600; color: #1976d2;">${this.gridAngle}°</span>
                        </label>
                        <input type="range" id="sp-grid-angle" value="${this.gridAngle}" min="0" max="90" step="1"
                            style="width: 100%; margin-bottom: 8px; cursor: pointer;">
                        <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                            <button class="sp-angle-btn" data-angle="0">0°</button>
                            <button class="sp-angle-btn" data-angle="15">15°</button>
                            <button class="sp-angle-btn" data-angle="30">30°</button>
                            <button class="sp-angle-btn" data-angle="45">45°</button>
                            <button class="sp-angle-btn" data-angle="60">60°</button>
                            <button class="sp-angle-btn" data-angle="75">75°</button>
                            <button class="sp-angle-btn" data-angle="90">90°</button>
                        </div>
                        <div style="margin-top: 8px; display: flex; align-items: center; gap: 8px;">
                            <button id="sp-angle-minus" class="sp-angle-step">−1°</button>
                            <input type="number" id="sp-angle-input" value="${this.gridAngle}" min="0" max="90" step="1"
                                style="width: 60px; padding: 4px 8px; border: 1px solid #ddd; border-radius: 4px; text-align: center; font-size: 14px;">
                            <button id="sp-angle-plus" class="sp-angle-step">+1°</button>
                        </div>
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
                </div>
                
                <style>
                    .sp-angle-btn {
                        padding: 4px 10px;
                        border: 1px solid #ddd;
                        background: #fff;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 11px;
                        transition: all 0.15s;
                    }
                    .sp-angle-btn:hover { background: #e3f2fd; border-color: #90caf9; }
                    .sp-angle-btn.active { background: #1976d2; color: white; border-color: #1976d2; }
                    .sp-angle-step {
                        padding: 6px 12px;
                        border: 1px solid #ddd;
                        background: #fff;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 13px;
                        font-weight: 500;
                    }
                    .sp-angle-step:hover { background: #e3f2fd; }
                    .sp-angle-step:active { background: #bbdefb; }
                </style>
            `;
            
            document.body.appendChild(this.settingsDialog);
            
            this._makeDraggable(this.settingsDialog, document.getElementById('sp-dialog-header'));
            
            const angleSlider = document.getElementById('sp-grid-angle');
            const angleInput = document.getElementById('sp-angle-input');
            const angleVal = document.getElementById('sp-angle-val');
            const cellSizeSlider = document.getElementById('sp-cell-size');
            const cellSizeVal = document.getElementById('sp-cell-val');
            
            const updateAngle = (val) => {
                val = Math.max(0, Math.min(90, parseInt(val) || 0));
                angleSlider.value = val;
                angleInput.value = val;
                angleVal.textContent = `${val}°`;
                
                document.querySelectorAll('.sp-angle-btn').forEach(btn => {
                    btn.classList.toggle('active', parseInt(btn.dataset.angle) === val);
                });
                
                const cellSize = parseInt(cellSizeSlider.value);
                this._updateGridPreview(polygonPoints, cellSize, val);
            };
            
            const updateCellSize = (val) => {
                cellSizeVal.textContent = val;
                const angle = parseInt(angleSlider.value);
                this._updateGridPreview(polygonPoints, parseInt(val), angle);
            };
            
            angleSlider.oninput = (e) => updateAngle(e.target.value);
            angleInput.oninput = (e) => updateAngle(e.target.value);
            
            document.getElementById('sp-angle-minus').onclick = () => updateAngle(parseInt(angleSlider.value) - 1);
            document.getElementById('sp-angle-plus').onclick = () => updateAngle(parseInt(angleSlider.value) + 1);
            
            document.querySelectorAll('.sp-angle-btn').forEach(btn => {
                btn.onclick = () => updateAngle(btn.dataset.angle);
            });
            
            cellSizeSlider.oninput = (e) => updateCellSize(e.target.value);
            
            document.getElementById('sp-height-step').oninput = (e) => {
                document.getElementById('sp-step-val').textContent = e.target.value;
            };
            
            updateAngle(this.gridAngle);
            
            document.getElementById('sp-dialog-close').onclick = () => {
                this._clearGridPreview();
                this.settingsDialog.remove();
                this.settingsDialog = null;
                resolve(null);
            };
            
            document.getElementById('sp-cancel-btn').onclick = () => {
                this._clearGridPreview();
                this.settingsDialog.remove();
                this.settingsDialog = null;
                resolve(null);
            };
            
            document.getElementById('sp-start-btn').onclick = async () => {
                const maxHeight = parseInt(document.getElementById('sp-max-height').value, 10);
                const cellSize = parseInt(document.getElementById('sp-cell-size').value, 10);
                const heightStep = parseInt(document.getElementById('sp-height-step').value, 10);
                const gridAngle = parseInt(document.getElementById('sp-grid-angle').value, 10);
                const fastMode = document.getElementById('sp-fast-mode').checked;
                
                if (isNaN(maxHeight) || maxHeight < 3 || maxHeight > 500) {
                    alert('Высота должна быть от 3 до 500 м');
                    return;
                }
                
                this.maxHeight = maxHeight;
                this.cellSize = cellSize;
                this.heightStep = heightStep;
                this.gridAngle = gridAngle;
                this.fastMode = fastMode;
                
                this._clearGridPreview();
                this.settingsDialog.remove();
                this.settingsDialog = null;
                
                const result = await this.calculate(polygonPoints);
                resolve(result);
            };
        });
    }
    
    /**
     * Сделать элемент перетаскиваемым
     */
    _makeDraggable(element, handle) {
        let offsetX = 0, offsetY = 0, startX = 0, startY = 0;
        
        handle.onmousedown = (e) => {
            e.preventDefault();
            startX = e.clientX;
            startY = e.clientY;
            
            document.onmousemove = (e) => {
                offsetX = startX - e.clientX;
                offsetY = startY - e.clientY;
                startX = e.clientX;
                startY = e.clientY;
                
                element.style.top = (element.offsetTop - offsetY) + 'px';
                element.style.left = (element.offsetLeft - offsetX) + 'px';
            };
            
            document.onmouseup = () => {
                document.onmousemove = null;
                document.onmouseup = null;
            };
        };
    }
    
    /**
     * Превью сетки с подрезкой
     */
    _updateGridPreview(polygonPoints, cellSize, gridAngle) {
        this._clearGridPreview();
        
        if (!polygonPoints || polygonPoints.length < 3) return;
        
        const group = new THREE.Group();
        group.userData = { type: 'preview', subtype: 'grid-preview' };
        
        let polygon = polygonPoints.map(p => ({ x: p.x, y: p.y }));
        
        // Убираем дубликаты
        polygon = polygon.filter((p, i, arr) => {
            if (i === 0) return true;
            const prev = arr[i - 1];
            return Math.abs(p.x - prev.x) > 0.01 || Math.abs(p.y - prev.y) > 0.01;
        });
        if (polygon.length > 1) {
            const first = polygon[0];
            const last = polygon[polygon.length - 1];
            if (Math.abs(first.x - last.x) < 0.01 && Math.abs(first.y - last.y) < 0.01) {
                polygon.pop();
            }
        }
        
        // Центр полигона
        let cx = 0, cy = 0;
        for (const p of polygon) { cx += p.x; cy += p.y; }
        cx /= polygon.length;
        cy /= polygon.length;
        
        const angleRad = gridAngle * Math.PI / 180;
        const cosA = Math.cos(angleRad);
        const sinA = Math.sin(angleRad);
        
        // Bounds
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        for (const p of polygon) {
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
        }
        
        // Расширяем
        const diagonal = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2);
        const expandedMinX = cx - diagonal - cellSize;
        const expandedMaxX = cx + diagonal + cellSize;
        const expandedMinY = cy - diagonal - cellSize;
        const expandedMaxY = cy + diagonal + cellSize;
        
        const halfCell = cellSize / 2;
        const groundZ = 0.3;
        const minArea = cellSize * cellSize * 0.1;
        
        const gridPositions = [];
        const fillPositions = [];
        const fillIndices = [];
        let vertexIndex = 0;
        
        // Генерируем сетку
        for (let gx = expandedMinX; gx <= expandedMaxX; gx += cellSize) {
            for (let gy = expandedMinY; gy <= expandedMaxY; gy += cellSize) {
                const dx = gx - cx;
                const dy = gy - cy;
                const worldX = dx * cosA - dy * sinA + cx;
                const worldY = dx * sinA + dy * cosA + cy;
                
                // Углы ячейки — сначала локальные, потом поворот
                const localCorners = [
                    { x: -halfCell, y: -halfCell },
                    { x: halfCell, y: -halfCell },
                    { x: halfCell, y: halfCell },
                    { x: -halfCell, y: halfCell }
                ];
                
                const cellCorners = localCorners.map(c => ({
                    x: worldX + c.x * cosA - c.y * sinA,
                    y: worldY + c.x * sinA + c.y * cosA
                }));
                
                // Проверяем пересечение: центр ИЛИ углы
                let hasIntersection = false;
                
                if (this._pointInPolygon(worldX, worldY, polygon)) {
                    hasIntersection = true;
                }
                
                if (!hasIntersection) {
                    for (const corner of cellCorners) {
                        if (this._pointInPolygon(corner.x, corner.y, polygon)) {
                            hasIntersection = true;
                            break;
                        }
                    }
                }
                
                if (!hasIntersection) {
                    for (const vertex of polygon) {
                        if (this._pointInPolygon(vertex.x, vertex.y, cellCorners)) {
                            hasIntersection = true;
                            break;
                        }
                    }
                }
                
                if (!hasIntersection) continue;
                
                // Подрезаем ячейку
                let clipped = this._clipCellByPolygon(cellCorners, polygon);
                
                // Fallback: если clipping не сработал но центр внутри — используем полную ячейку
                if (!clipped || clipped.length < 3) {
                    if (this._pointInPolygon(worldX, worldY, polygon)) {
                        clipped = cellCorners;
                    } else {
                        continue;
                    }
                }
                
                const area = this._polygonArea(clipped);
                if (area < minArea) continue;
                
                // Линии границ
                for (let i = 0; i < clipped.length; i++) {
                    const p1 = clipped[i];
                    const p2 = clipped[(i + 1) % clipped.length];
                    gridPositions.push(p1.x, p1.y, groundZ, p2.x, p2.y, groundZ);
                }
                
                // Заливка (триангуляция веером)
                const firstVertex = vertexIndex;
                for (const p of clipped) {
                    fillPositions.push(p.x, p.y, groundZ - 0.05);
                }
                for (let i = 1; i < clipped.length - 1; i++) {
                    fillIndices.push(firstVertex, firstVertex + i, firstVertex + i + 1);
                }
                vertexIndex += clipped.length;
            }
        }
        
        // Линии сетки
        if (gridPositions.length > 0) {
            const gridGeometry = new THREE.BufferGeometry();
            gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPositions, 3));
            const gridMaterial = new THREE.LineBasicMaterial({ color: 0x2196f3, transparent: true, opacity: 0.8 });
            group.add(new THREE.LineSegments(gridGeometry, gridMaterial));
        }
        
        // Заливка
        if (fillPositions.length > 0) {
            const fillGeometry = new THREE.BufferGeometry();
            fillGeometry.setAttribute('position', new THREE.Float32BufferAttribute(fillPositions, 3));
            fillGeometry.setIndex(fillIndices);
            const fillMaterial = new THREE.MeshBasicMaterial({ color: 0x2196f3, transparent: true, opacity: 0.15, side: THREE.DoubleSide });
            group.add(new THREE.Mesh(fillGeometry, fillMaterial));
        }
        
        // Контур полигона
        const outlinePositions = [];
        for (let i = 0; i < polygon.length; i++) {
            const p1 = polygon[i];
            const p2 = polygon[(i + 1) % polygon.length];
            outlinePositions.push(p1.x, p1.y, groundZ + 0.1, p2.x, p2.y, groundZ + 0.1);
        }
        const outlineGeometry = new THREE.BufferGeometry();
        outlineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(outlinePositions, 3));
        const outlineMaterial = new THREE.LineBasicMaterial({ color: 0xff5722, linewidth: 2 });
        group.add(new THREE.LineSegments(outlineGeometry, outlineMaterial));
        
        // Стрелка направления
        const arrowLength = Math.min(maxX - minX, maxY - minY) * 0.3;
        const arrowX = cosA * arrowLength;
        const arrowY = sinA * arrowLength;
        const arrowGeometry = new THREE.BufferGeometry();
        arrowGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
            cx, cy, groundZ + 0.2,
            cx + arrowX, cy + arrowY, groundZ + 0.2
        ], 3));
        const arrowMaterial = new THREE.LineBasicMaterial({ color: 0x4caf50, linewidth: 3 });
        group.add(new THREE.LineSegments(arrowGeometry, arrowMaterial));
        
        this._previewGroup = group;
        this.sceneManager.getBuildingsGroup().add(group);
    }
    
    /**
     * Знаковая площадь (отрицательная = CCW)
     */
    _signedPolygonArea(polygon) {
        let area = 0;
        for (let i = 0; i < polygon.length; i++) {
            const j = (i + 1) % polygon.length;
            area += polygon[i].x * polygon[j].y;
            area -= polygon[j].x * polygon[i].y;
        }
        return area / 2;
    }
    
    /**
     * Площадь полигона
     */
    _polygonArea(polygon) {
        return Math.abs(this._signedPolygonArea(polygon));
    }
    
    _clearGridPreview() {
        if (this._previewGroup) {
            this.sceneManager.getBuildingsGroup().remove(this._previewGroup);
            this._previewGroup.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            this._previewGroup = null;
        }
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
        
        this._originalPolygon = polygonPoints.map(p => ({ x: p.x, y: p.y }));
        
        this.isCalculating = true;
        this.isCancelled = false;
        
        const startTime = performance.now();
        console.log(`[SolarPotential] Старт. Точек: ${existingPoints.length}, макс: ${this.maxHeight}м, ячейка: ${this.cellSize}м, угол: ${this.gridAngle}°`);
        
        this._showProgress(0, 'Инициализация...');
        
        this._cacheNormalizedSunVectors();
        this._saveBaseline(existingPoints);
        
        await this._sleep(10);
        
        this._createColumns(polygonPoints);
        
        if (this.columns.length === 0) {
            this._hideProgress();
            this.isCalculating = false;
            alert('Не удалось создать сетку. Проверьте полигон.');
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
        
        // DEBUG: Финальная проверка инсоляции
        this._verifyFinalState(existingPoints);
        
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
     * Создать колонки с подрезкой по контуру
     */
    _createColumns(polygonPoints) {
        this.columns = [];
        this._clearTempMeshes();
        
        // Копируем полигон и убираем дублирующиеся точки
        let polygon = polygonPoints.map(p => ({ x: p.x, y: p.y }));
        
        // Убираем дубликаты (особенно последняя = первая)
        polygon = polygon.filter((p, i, arr) => {
            if (i === 0) return true;
            const prev = arr[i - 1];
            return Math.abs(p.x - prev.x) > 0.01 || Math.abs(p.y - prev.y) > 0.01;
        });
        // Также проверяем последняя = первая
        if (polygon.length > 1) {
            const first = polygon[0];
            const last = polygon[polygon.length - 1];
            if (Math.abs(first.x - last.x) < 0.01 && Math.abs(first.y - last.y) < 0.01) {
                polygon.pop();
            }
        }
        
        // Центр полигона
        let cx = 0, cy = 0;
        for (const p of polygon) { cx += p.x; cy += p.y; }
        cx /= polygon.length;
        cy /= polygon.length;
        
        const angleRad = this.gridAngle * Math.PI / 180;
        const cosA = Math.cos(angleRad);
        const sinA = Math.sin(angleRad);
        
        // Bounds
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        for (const p of polygon) {
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
        }
        
        // Расширяем для покрытия при повороте + запас для краевых ячеек
        const diagonal = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2);
        const expandedMinX = cx - diagonal - this.cellSize;
        const expandedMaxX = cx + diagonal + this.cellSize;
        const expandedMinY = cy - diagonal - this.cellSize;
        const expandedMaxY = cy + diagonal + this.cellSize;
        
        const halfCell = this.cellSize / 2;
        const group = this.sceneManager.getBuildingsGroup();
        const minArea = this.cellSize * this.cellSize * 0.1; // Минимум 10% площади
        
        let index = 0;
        let testedCount = 0;
        let clippedCount = 0;
        
        // DEBUG
        console.log(`[SolarPotential] DEBUG Полигон:`, polygon.map(p => `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`).join(' → '));
        console.log(`[SolarPotential] DEBUG Центр полигона: (${cx.toFixed(1)}, ${cy.toFixed(1)}), угол: ${this.gridAngle}°`);
        console.log(`[SolarPotential] DEBUG Bounds: X[${expandedMinX.toFixed(0)}..${expandedMaxX.toFixed(0)}], Y[${expandedMinY.toFixed(0)}..${expandedMaxY.toFixed(0)}]`);
        
        let closestToCenter = null;
        let closestDist = Infinity;
        
        for (let gx = expandedMinX; gx <= expandedMaxX; gx += this.cellSize) {
            for (let gy = expandedMinY; gy <= expandedMaxY; gy += this.cellSize) {
                testedCount++;
                
                // Координаты центра ячейки с поворотом относительно центра полигона
                const dx = gx - cx;
                const dy = gy - cy;
                const worldX = dx * cosA - dy * sinA + cx;
                const worldY = dx * sinA + dy * cosA + cy;
                
                // Углы ячейки — сначала локальные, потом поворот
                const localCorners = [
                    { x: -halfCell, y: -halfCell },
                    { x: halfCell, y: -halfCell },
                    { x: halfCell, y: halfCell },
                    { x: -halfCell, y: halfCell }
                ];
                
                // Поворачиваем углы и добавляем к мировой позиции
                const cellCorners = localCorners.map(c => ({
                    x: worldX + c.x * cosA - c.y * sinA,
                    y: worldY + c.x * sinA + c.y * cosA
                }));
                
                // Запоминаем ближайшую к центру полигона
                const dist = Math.sqrt((worldX - cx) ** 2 + (worldY - cy) ** 2);
                if (dist < closestDist) {
                    closestDist = dist;
                    closestToCenter = { worldX, worldY, cellCorners: cellCorners.slice() };
                }
                
                // Проверяем: центр внутри ИЛИ хотя бы один угол внутри ИЛИ хотя бы одна вершина полигона внутри ячейки
                let hasIntersection = false;
                
                // 1. Центр ячейки внутри полигона?
                const centerInside = this._pointInPolygon(worldX, worldY, polygon);
                if (centerInside) {
                    hasIntersection = true;
                }
                
                // 2. Хотя бы один угол ячейки внутри полигона?
                let cornersInside = 0;
                if (!hasIntersection) {
                    for (const corner of cellCorners) {
                        if (this._pointInPolygon(corner.x, corner.y, polygon)) {
                            cornersInside++;
                            hasIntersection = true;
                        }
                    }
                }
                
                // 3. Хотя бы одна вершина полигона внутри ячейки?
                let verticesInside = 0;
                if (!hasIntersection) {
                    for (const vertex of polygon) {
                        if (this._pointInPolygon(vertex.x, vertex.y, cellCorners)) {
                            verticesInside++;
                            hasIntersection = true;
                        }
                    }
                }
                
                // DEBUG: Логируем ближайшую к центру ячейку
                if (dist < 30) {
                    console.log(`[SolarPotential] DEBUG Ячейка (${worldX.toFixed(1)}, ${worldY.toFixed(1)}): center=${centerInside}, corners=${cornersInside}, vertices=${verticesInside}, result=${hasIntersection}`);
                }
                
                if (!hasIntersection) continue;
                
                // Подрезаем ячейку по полигону
                const clipped = this._clipCellByPolygon(cellCorners, polygon);
                
                if (!clipped || clipped.length < 3) {
                    // Если clipping не сработал, используем полную ячейку если центр внутри
                    if (centerInside) {
                        clippedCount++;
                        this._createColumnFromCell(cellCorners, worldX, worldY, this.cellSize * this.cellSize, index++, group);
                    }
                    continue;
                }
                
                const area = this._polygonArea(clipped);
                if (area < minArea) continue;
                
                clippedCount++;
                this._createColumnFromCell(clipped, worldX, worldY, area, index++, group);
            }
        }
        
        console.log(`[SolarPotential] Сетка: проверено ${testedCount}, пересекаются ${clippedCount}, создано ${this.columns.length} колонок`);
        
        // DEBUG: Выводим ближайшую к центру ячейку
        if (closestToCenter) {
            console.log(`[SolarPotential] DEBUG Ближайшая ячейка к центру: (${closestToCenter.worldX.toFixed(1)}, ${closestToCenter.worldY.toFixed(1)})`);
            console.log(`[SolarPotential] DEBUG Её углы:`, closestToCenter.cellCorners.map(p => `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`).join(' → '));
            
            // Проверяем эту ячейку
            const intersects = this._polygonsIntersect(closestToCenter.cellCorners, polygon);
            console.log(`[SolarPotential] DEBUG Пересекает полигон: ${intersects}`);
            
            // Проверяем каждый угол
            for (let i = 0; i < closestToCenter.cellCorners.length; i++) {
                const p = closestToCenter.cellCorners[i];
                const inside = this._pointInPolygon(p.x, p.y, polygon);
                console.log(`[SolarPotential] DEBUG Угол ${i} (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) внутри: ${inside}`);
            }
        }
    }
    
    /**
     * Создать колонку из ячейки
     */
    _createColumnFromCell(cellPolygon, worldX, worldY, area, index, group) {
        // Создаём Shape в локальных координатах (относительно worldX, worldY)
        const shape = new THREE.Shape();
        shape.moveTo(cellPolygon[0].x - worldX, cellPolygon[0].y - worldY);
        for (let i = 1; i < cellPolygon.length; i++) {
            shape.lineTo(cellPolygon[i].x - worldX, cellPolygon[i].y - worldY);
        }
        shape.closePath();
        
        const column = {
            x: worldX,
            y: worldY,
            height: 0,
            stopped: false,
            violationType: null,
            mesh: null,
            index: index,
            shape: shape,
            clippedPolygon: cellPolygon,
            area: area
        };
        
        const geometry = new THREE.ExtrudeGeometry(shape, {
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
        mesh.position.set(worldX, worldY, 0);
        mesh.visible = false;
        
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
    
    /**
     * Проверка пересечения двух полигонов (быстрая)
     */
    _polygonsIntersect(poly1, poly2) {
        // Проверяем: хотя бы одна вершина poly1 внутри poly2
        for (const p of poly1) {
            if (this._pointInPolygon(p.x, p.y, poly2)) return true;
        }
        // Или хотя бы одна вершина poly2 внутри poly1
        for (const p of poly2) {
            if (this._pointInPolygon(p.x, p.y, poly1)) return true;
        }
        // Или рёбра пересекаются
        for (let i = 0; i < poly1.length; i++) {
            const a1 = poly1[i];
            const a2 = poly1[(i + 1) % poly1.length];
            for (let j = 0; j < poly2.length; j++) {
                const b1 = poly2[j];
                const b2 = poly2[(j + 1) % poly2.length];
                if (this._segmentsIntersect(a1, a2, b1, b2)) return true;
            }
        }
        return false;
    }
    
    /**
     * Проверка пересечения двух отрезков
     */
    _segmentsIntersect(a1, a2, b1, b2) {
        const d1 = this._cross(b2.x - b1.x, b2.y - b1.y, a1.x - b1.x, a1.y - b1.y);
        const d2 = this._cross(b2.x - b1.x, b2.y - b1.y, a2.x - b1.x, a2.y - b1.y);
        const d3 = this._cross(a2.x - a1.x, a2.y - a1.y, b1.x - a1.x, b1.y - a1.y);
        const d4 = this._cross(a2.x - a1.x, a2.y - a1.y, b2.x - a1.x, b2.y - a1.y);
        
        if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
            ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
            return true;
        }
        return false;
    }
    
    /**
     * Cross product 2D
     */
    _cross(ax, ay, bx, by) {
        return ax * by - ay * bx;
    }
    
    /**
     * Подрезка ячейки по полигону (Sutherland-Hodgman)
     */
    _clipCellByPolygon(cell, polygon) {
        // Нормализуем направление обхода — нужен CCW (против часовой)
        const normalizedPolygon = this._ensureCCW(polygon);
        let output = cell.slice();
        
        for (let i = 0; i < normalizedPolygon.length; i++) {
            if (output.length === 0) return null;
            
            const edgeStart = normalizedPolygon[i];
            const edgeEnd = normalizedPolygon[(i + 1) % normalizedPolygon.length];
            
            const input = output;
            output = [];
            
            for (let j = 0; j < input.length; j++) {
                const current = input[j];
                const next = input[(j + 1) % input.length];
                
                const currentInside = this._isLeftOfEdge(current, edgeStart, edgeEnd);
                const nextInside = this._isLeftOfEdge(next, edgeStart, edgeEnd);
                
                if (currentInside) {
                    output.push(current);
                    if (!nextInside) {
                        const intersection = this._edgeIntersection(edgeStart, edgeEnd, current, next);
                        if (intersection) output.push(intersection);
                    }
                } else if (nextInside) {
                    const intersection = this._edgeIntersection(edgeStart, edgeEnd, current, next);
                    if (intersection) output.push(intersection);
                }
            }
        }
        
        return output.length >= 3 ? output : null;
    }
    
    /**
     * Нормализовать полигон к CCW (против часовой стрелки)
     */
    _ensureCCW(polygon) {
        const area = this._signedPolygonArea(polygon);
        // Если area > 0, полигон CW — нужно развернуть
        if (area > 0) {
            return polygon.slice().reverse();
        }
        return polygon.slice();
    }
    
    /**
     * Точка слева от ребра (внутри полигона при CCW обходе)
     */
    _isLeftOfEdge(point, edgeStart, edgeEnd) {
        const cross = (edgeEnd.x - edgeStart.x) * (point.y - edgeStart.y) - 
                      (edgeEnd.y - edgeStart.y) * (point.x - edgeStart.x);
        return cross >= 0;
    }
    
    /**
     * Пересечение ребра clipping polygon и отрезка
     */
    _edgeIntersection(edgeStart, edgeEnd, lineStart, lineEnd) {
        const x1 = edgeStart.x, y1 = edgeStart.y;
        const x2 = edgeEnd.x, y2 = edgeEnd.y;
        const x3 = lineStart.x, y3 = lineStart.y;
        const x4 = lineEnd.x, y4 = lineEnd.y;
        
        const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
        if (Math.abs(denom) < 1e-10) return null;
        
        const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
        
        return {
            x: x1 + t * (x2 - x1),
            y: y1 + t * (y2 - y1)
        };
    }
    
    /**
     * Растить колонки
     */
    async _growColumns(existingPoints) {
        const sunVectors = this.normalizedSunVectors;
        const totalSteps = Math.ceil(this.maxHeight / this.heightStep);
        
        const checkPoints = [];
        for (let i = 0; i < existingPoints.length; i++) {
            const status = this.baselineStatus.get(i);
            if (status !== 'FAIL') {
                checkPoints.push({ index: i, point: existingPoints[i] });
            }
        }
        
        console.log(`[SolarPotential] Начинаем рост. Проверяем ${checkPoints.length} точек (исключены ${existingPoints.length - checkPoints.length} уже FAIL)`);
        console.log(`[SolarPotential] Всего колонок: ${this.columns.length}, шагов: ${totalSteps}, макс высота: ${this.maxHeight}м`);
        
        this.previousStatus = new Map();
        for (const { index } of checkPoints) {
            this.previousStatus.set(index, this.baselineStatus.get(index));
        }
        
        let step = 0;
        
        while (!this.isCancelled && step < totalSteps) {
            step++;
            const targetHeight = step * this.heightStep;
            
            let activeCount = 0;
            for (const col of this.columns) {
                if (!col.stopped) {
                    col.height = Math.min(targetHeight, this.maxHeight);
                    this._updateColumnMesh(col);
                    activeCount++;
                }
            }
            
            if (activeCount === 0) break;
            
            const progress = 5 + (step / totalSteps) * 85;
            this._showProgress(progress, `Высота: ${targetHeight}м (${activeCount} растут)`);
            
            if (!this.fastMode) {
                await this._sleep(this.animationDelay);
            }
            
            await this._checkAndRollback(checkPoints, sunVectors, targetHeight);
        }
    }
    
    _updateColumnMesh(column) {
        const mesh = column.mesh;
        if (!mesh || !column.shape) return;
        
        if (column.height <= 0) {
            mesh.visible = false;
            mesh.userData.properties.height = 0;
            return;
        }
        
        const oldGeometry = mesh.geometry;
        
        const newGeometry = new THREE.ExtrudeGeometry(column.shape, {
            depth: column.height,
            bevelEnabled: false
        });
        
        // ВАЖНО: Вычисляем bounding box/sphere для корректного raycasting
        newGeometry.computeBoundingBox();
        newGeometry.computeBoundingSphere();
        
        mesh.geometry = newGeometry;
        oldGeometry.dispose();
        
        mesh.visible = true;
        mesh.userData.properties.height = column.height;
        
        // ВАЖНО: Обновляем матрицы для корректного raycasting
        mesh.updateMatrix();
        mesh.updateMatrixWorld(true);
    }
    
    async _checkAndRollback(checkPoints, sunVectors, targetHeight) {
        const activeMeshes = this.tempMeshes.filter(m => m.visible);
        if (activeMeshes.length === 0) return;
        
        // ВАЖНО: Сбрасываем кэш ПЕРЕД проверкой
        this.calculator.invalidateObstaclesCache();
        
        // DEBUG: Проверяем что колонки видны калькулятору
        if (targetHeight <= this.heightStep * 3) {
            const buildingsGroup = this.sceneManager.getBuildingsGroup();
            let hillCount = 0;
            let visibleHillCount = 0;
            let totalBuildings = 0;
            
            buildingsGroup.children.forEach(child => {
                if (child.userData.type === 'building') {
                    totalBuildings++;
                    if (child.userData.subtype === 'solar-potential-column') {
                        hillCount++;
                        if (child.visible) visibleHillCount++;
                    }
                }
            });
            
            console.log(`[SolarPotential] DEBUG h=${targetHeight}м: всего buildings=${totalBuildings}, колонок горки=${hillCount}, visible=${visibleHillCount}, activeMeshes=${activeMeshes.length}`);
            
            // Проверяем первую видимую колонку
            const firstVisible = activeMeshes[0];
            if (firstVisible) {
                console.log(`[SolarPotential] DEBUG первая колонка: visible=${firstVisible.visible}, type=${firstVisible.userData.type}, height=${firstVisible.userData.properties?.height}, geometry.boundingBox=${!!firstVisible.geometry?.boundingBox}`);
            }
        }
        
        const violations = [];
        const newStatuses = new Map();
        
        let isFirst = true;
        for (const { index, point } of checkPoints) {
            const prevStatus = this.previousStatus.get(index);
            
            // forceRefreshCache = true для первой точки
            const result = this.calculator.calculatePoint(point, null, 120, isFirst);
            
            // DEBUG: На первой точке проверяем что калькулятор видит колонки
            if (isFirst && targetHeight <= this.heightStep * 3) {
                const cachedObstacles = this.calculator._cachedObstacles;
                if (cachedObstacles) {
                    const hillObstacles = cachedObstacles.filter(o => 
                        o.userData.subtype === 'solar-potential-column'
                    );
                    console.log(`[SolarPotential] DEBUG: Калькулятор видит ${cachedObstacles.length} obstacles, из них колонок горки: ${hillObstacles.length}`);
                }
            }
            
            isFirst = false;
            
            const newStatus = result ? result.evaluation.status : 'PASS';
            newStatuses.set(index, newStatus);
            
            const degradation = this._getDegradationType(prevStatus, newStatus);
            
            // DEBUG: Логируем любое изменение статуса
            if (prevStatus !== newStatus && targetHeight <= this.heightStep * 5) {
                const minutes = result?.evaluation?.totalMinutes || 0;
                console.log(`[SolarPotential] Точка ${index}: ${prevStatus}→${newStatus} (${minutes} мин)`);
            }
            
            if (degradation) {
                violations.push({ index, point, prevStatus, newStatus, degradation });
            }
        }
        
        if (violations.length === 0) {
            // Периодически логируем что всё ок
            if (targetHeight % (this.heightStep * 5) === 0) {
                console.log(`[SolarPotential] h=${targetHeight}м: нарушений нет ✓`);
            }
            for (const [idx, status] of newStatuses) {
                this.previousStatus.set(idx, status);
            }
            return;
        }
        
        console.log(`[SolarPotential] h=${targetHeight}м: ${violations.length} нарушений!`);
        
        const blockersToRollback = new Map();
        
        for (const v of violations) {
            const blocker = this._findBlockingColumn(v.point, sunVectors, activeMeshes);
            
            if (blocker && !blocker.stopped) {
                const existing = blockersToRollback.get(blocker);
                if (!existing || v.degradation === 'fail') {
                    blockersToRollback.set(blocker, v);
                }
            } else if (!blocker) {
                // DEBUG: Нарушение есть, но блокировщик не найден среди колонок
                console.log(`[SolarPotential] WARNING: Нарушение ${v.prevStatus}→${v.newStatus}, но блокировщик НЕ найден!`);
            }
        }
        
        for (const [blocker, violation] of blockersToRollback) {
            const oldHeight = blocker.height;
            blocker.height = Math.max(0, blocker.height - this.heightStep);
            blocker.stopped = true;
            
            if (violation.degradation === 'fail') {
                blocker.violationType = 'fail';
                this._setColumnColor(blocker, this.colors.fail);
            } else {
                blocker.violationType = 'warning';
                this._setColumnColor(blocker, this.colors.warning);
            }
            
            this._updateColumnMesh(blocker);
            
            console.log(`[SolarPotential] Колонка ${blocker.index}: ${violation.prevStatus}→${violation.newStatus}, откат ${oldHeight}→${blocker.height}м`);
        }
        
        if (blockersToRollback.size > 0) {
            this.calculator.invalidateObstaclesCache();
        }
        
        const violationIndices = new Set(violations.map(v => v.index));
        for (const [idx, status] of newStatuses) {
            if (!violationIndices.has(idx)) {
                this.previousStatus.set(idx, status);
            }
        }
    }
    
    _getDegradationType(before, after) {
        if (after === 'FAIL' && before !== 'FAIL') return 'fail';
        if (before === 'PASS' && after === 'WARNING') return 'warning';
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
        
        // Считаем сколько лучей блокирует каждая колонка
        const blockCounts = new Map();
        
        for (const dir of sunVectors) {
            this.raycaster.set(pos, dir);
            this.raycaster.far = 500;
            const hits = this.raycaster.intersectObjects(activeMeshes, false);
            
            for (const hit of hits) {
                if (hit.distance > 0.5) {
                    const column = this.meshToColumnMap.get(hit.object);
                    if (column && !column.stopped) {
                        blockCounts.set(column, (blockCounts.get(column) || 0) + 1);
                    }
                    break; // Считаем только первое пересечение
                }
            }
        }
        
        // Возвращаем колонку с максимальным количеством блокировок
        let maxBlocker = null;
        let maxBlocks = 0;
        
        for (const [column, count] of blockCounts) {
            if (count > maxBlocks) {
                maxBlocks = count;
                maxBlocker = column;
            }
        }
        
        return maxBlocker;
    }
    
    _createFinalResult() {
        const activeColumns = this.columns.filter(c => c.height > 0);
        
        if (activeColumns.length === 0) {
            console.log('[SolarPotential] Нет активных колонок');
            return;
        }
        
        this._createGroundOutline();
    }
    
    _createGroundOutline() {
        if (!this._originalPolygon || this._originalPolygon.length < 3) return;
        
        const positions = [];
        for (let i = 0; i < this._originalPolygon.length; i++) {
            const p1 = this._originalPolygon[i];
            const p2 = this._originalPolygon[(i + 1) % this._originalPolygon.length];
            positions.push(p1.x, p1.y, 0.1, p2.x, p2.y, 0.1);
        }
        
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        
        const material = new THREE.LineBasicMaterial({ color: 0x333333, linewidth: 2 });
        
        this.groundOutline = new THREE.LineSegments(geometry, material);
        this.groundOutline.userData = { subtype: 'solar-potential-footprint' };
        
        this.sceneManager.getBuildingsGroup().add(this.groundOutline);
    }
    
    // ===== UI =====
    
    _showProgress(percent, text) {
        if (!document.getElementById('solar-potential-styles')) {
            const style = document.createElement('style');
            style.id = 'solar-potential-styles';
            style.textContent = `@keyframes solar-potential-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`;
            document.head.appendChild(style);
        }
        
        if (!this.progressOverlay) {
            this.progressOverlay = document.createElement('div');
            this.progressOverlay.id = 'solar-potential-progress';
            this.progressOverlay.style.cssText = `position: fixed; top: 20px; right: 20px; z-index: 10000; background: white; padding: 12px 16px; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,0.2); font-family: -apple-system, sans-serif; font-size: 13px; min-width: 280px;`;
            document.body.appendChild(this.progressOverlay);
        }
        
        this.progressOverlay.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                <div style="width: 18px; height: 18px; border: 2px solid #e5e5e5; border-top-color: #4caf50; border-radius: 50%; animation: solar-potential-spin 0.8s linear infinite;"></div>
                <span style="color: #333; font-weight: 500;">Инсоляционная горка</span>
                <button id="sp-cancel" style="margin-left: auto; background: none; border: none; color: #999; cursor: pointer; font-size: 18px;">×</button>
            </div>
            <div style="background: #eee; border-radius: 4px; height: 6px; overflow: hidden;">
                <div style="background: linear-gradient(90deg, #4caf50, #ffeb3b, #f44336); height: 100%; width: ${percent}%; transition: width 0.3s;"></div>
            </div>
            <div style="margin-top: 6px; color: #666; font-size: 11px;">${text || `${percent.toFixed(0)}%`}</div>
        `;
        
        document.getElementById('sp-cancel').onclick = () => this.cancel();
    }
    
    _hideProgress() {
        if (this.progressOverlay) { this.progressOverlay.remove(); this.progressOverlay = null; }
    }
    
    _showControlPanel() {
        this._hideControlPanel();
        
        this.controlPanel = document.createElement('div');
        this.controlPanel.id = 'solar-potential-panel';
        this.controlPanel.style.cssText = `
            position: fixed;
            top: 100px;
            left: 100px;
            z-index: 9999;
            background: white;
            border-radius: 6px;
            box-shadow: 0 0 0 1px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.15);
            font-family: -apple-system, sans-serif;
            font-size: 11px;
            min-width: 200px;
            user-select: none;
        `;
        
        const stats = this._calculateStats();
        
        this.controlPanel.innerHTML = `
            <div id="sp-panel-header" style="
                padding: 10px 12px;
                background: #f5f5f5;
                border-radius: 6px 6px 0 0;
                cursor: move;
                display: flex;
                align-items: center;
                border-bottom: 1px solid #e0e0e0;
            ">
                <span style="font-weight: 600; color: #333;">⛰️ Инсоляционная горка</span>
                <button id="sp-close" style="margin-left: auto; background: none; border: none; cursor: pointer; color: #999; font-size: 16px;">×</button>
            </div>
            <div style="padding: 12px;">
                <div style="font-size: 10px; color: #666; margin-bottom: 8px;">
                    🟢 ${stats.safeCount} &nbsp; 🟡 ${stats.warningCount} &nbsp; 🔴 ${stats.failCount}
                </div>
                <div style="font-size: 10px; color: #666; margin-bottom: 10px;">
                    Объём: ${stats.totalVolume.toFixed(0)} м³ | Макс: ${stats.maxHeight}м | ∠${this.gridAngle}°
                </div>
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    ${this.isFinalized ? `
                        <div style="padding: 8px 12px; background: #4caf50; color: white; border-radius: 4px; font-size: 12px; font-weight: 500; text-align: center;">🔒 Финализирован</div>
                        <button id="sp-place-towers" class="sp-btn" style="background: #2196f3 !important; color: white !important; border-color: #2196f3 !important; font-weight: 500;">🏗️ Разместить башни</button>
                        <hr style="border: none; border-top: 1px solid #eee; margin: 4px 0;">
                        <button id="sp-edit" class="sp-btn" style="background: #ff9800 !important; color: white !important;">✏️ Редактировать</button>
                    ` : `
                        <button id="sp-finalize" class="sp-btn sp-finalize-btn">✓ Финализировать</button>
                        <hr style="border: none; border-top: 1px solid #eee; margin: 4px 0;">
                        <button id="sp-lock" class="sp-btn ${this.isLocked ? 'active' : ''}">${this.isLocked ? '🔒 Заблокировано' : '🔓 Разблокировано'}</button>
                        <button id="sp-ray-block" class="sp-btn ${this.isRayBlocked ? 'active' : ''}">${this.isRayBlocked ? '🚫 Лучи: выкл' : '☀️ Лучи: вкл'}</button>
                        <button id="sp-ghost" class="sp-btn ${this.isGhostMode ? 'active' : ''}">${this.isGhostMode ? '👻 Прозрачный' : '🎨 Цветной'}</button>
                    `}
                    <button id="sp-visibility" class="sp-btn ${this.isHidden ? 'active' : ''}">${this.isHidden ? '👁‍🗨 Скрыт' : '👁 Видимый'}</button>
                    <button id="sp-footprint" class="sp-btn ${this.isFootprintHidden ? 'active' : ''}">${this.isFootprintHidden ? '⬡ Футпринт скрыт' : '⬡ Футпринт'}</button>
                    <hr style="border: none; border-top: 1px solid #eee; margin: 4px 0;">
                    <button id="sp-clear" class="sp-btn" style="color: #d32f2f;">🗑 Удалить</button>
                </div>
            </div>
            <style>
                .sp-btn { background: #f5f5f5; border: 1px solid #ddd; padding: 6px 10px; border-radius: 4px; cursor: pointer; text-align: left; font-size: 12px; transition: all 0.15s; }
                .sp-btn:hover { background: #eee; }
                .sp-btn.active { background: #e3f2fd; border-color: #90caf9; color: #1976d2; }
                .sp-finalize-btn { background: #4caf50 !important; color: white !important; border-color: #4caf50 !important; font-weight: 500; }
                .sp-finalize-btn:hover { background: #43a047 !important; }
            </style>
        `;
        
        document.body.appendChild(this.controlPanel);
        
        // Make draggable
        this._makeDraggable(this.controlPanel, document.getElementById('sp-panel-header'));
        
        document.getElementById('sp-close').onclick = () => this._hideControlPanel();
        
        if (this.isFinalized) {
            document.getElementById('sp-place-towers').onclick = () => {
                window.dispatchEvent(new CustomEvent('start-tower-placement', { detail: { envelope: this } }));
            };
            document.getElementById('sp-edit').onclick = () => this.unfinalize();
        } else {
            document.getElementById('sp-finalize').onclick = () => this.finalize();
            document.getElementById('sp-lock').onclick = () => { this.toggleLock(); this._updateControlPanel(); };
            document.getElementById('sp-ray-block').onclick = () => { this.toggleRayBlock(); this._updateControlPanel(); };
            document.getElementById('sp-ghost').onclick = () => { this.toggleGhostMode(); this._updateControlPanel(); };
        }
        
        document.getElementById('sp-visibility').onclick = () => { 
            if (this.isFinalized) this.toggleFinalizedVisibility();
            else this.toggleVisibility(); 
            this._updateControlPanel(); 
        };
        document.getElementById('sp-footprint').onclick = () => { this.toggleFootprint(); this._updateControlPanel(); };
        document.getElementById('sp-clear').onclick = () => { if (confirm('Удалить горку?')) this.clear(); };
    }
    
    _updateControlPanel() {
        if (this.controlPanel) {
            // Re-create panel to update state
            this._showControlPanel();
        }
    }
    
    _hideControlPanel() {
        if (this.controlPanel) { this.controlPanel.remove(); this.controlPanel = null; }
    }
    
    showPanel() { this._showControlPanel(); }
    hidePanel() { this._hideControlPanel(); }
    
    // ===== Toggles =====
    
    toggleLock() { this.isLocked = !this.isLocked; return this.isLocked; }
    
    toggleRayBlock() {
        this.isRayBlocked = !this.isRayBlocked;
        const newType = this.isRayBlocked ? 'ghost' : 'building';
        for (const col of this.columns) { if (col.mesh) col.mesh.userData.type = newType; }
        if (this.calculator) this.calculator.invalidateObstaclesCache();
        return this.isRayBlocked;
    }
    
    toggleGhostMode() {
        this.isGhostMode = !this.isGhostMode;
        if (this.isGhostMode) {
            for (const col of this.columns) {
                if (col.mesh && col.mesh.material) {
                    this.savedColors.set(col.index, col.mesh.material.color.getHex());
                    col.mesh.material.color.setHex(this.colors.ghost);
                    col.mesh.material.opacity = this.ghostOpacity;
                    col.mesh.material.needsUpdate = true;
                }
            }
        } else {
            for (const col of this.columns) {
                if (col.mesh && col.mesh.material) {
                    const savedColor = this.savedColors.get(col.index);
                    if (savedColor !== undefined) col.mesh.material.color.setHex(savedColor);
                    else {
                        if (col.violationType === 'fail') col.mesh.material.color.setHex(this.colors.fail);
                        else if (col.violationType === 'warning') col.mesh.material.color.setHex(this.colors.warning);
                        else col.mesh.material.color.setHex(this.colors.safe);
                    }
                    col.mesh.material.opacity = this.defaultOpacity;
                    col.mesh.material.needsUpdate = true;
                }
            }
        }
        return this.isGhostMode;
    }
    
    select() { if (this.isSelected) return; this.isSelected = true; for (const col of this.columns) { if (col.mesh && col.mesh.material) { col.mesh.material.opacity = 0.8; col.mesh.material.needsUpdate = true; } } }
    deselect() { if (!this.isSelected) return; this.isSelected = false; const opacity = this.isGhostMode ? this.ghostOpacity : this.defaultOpacity; for (const col of this.columns) { if (col.mesh && col.mesh.material) { col.mesh.material.opacity = opacity; col.mesh.material.needsUpdate = true; } } }
    
    hide() { this.isHidden = true; for (const col of this.columns) { if (col.mesh) col.mesh.visible = false; } if (this.groundOutline) this.groundOutline.visible = false; }
    show() { this.isHidden = false; for (const col of this.columns) { if (col.mesh && col.height > 0) col.mesh.visible = true; } if (this.groundOutline && !this.isFootprintHidden) this.groundOutline.visible = true; }
    toggleVisibility() { if (this.isHidden) this.show(); else this.hide(); return !this.isHidden; }
    
    hideFootprint() { this.isFootprintHidden = true; if (this.groundOutline) this.groundOutline.visible = false; }
    showFootprint() { this.isFootprintHidden = false; if (this.groundOutline) this.groundOutline.visible = true; }
    toggleFootprint() { if (this.isFootprintHidden) this.showFootprint(); else this.hideFootprint(); return !this.isFootprintHidden; }
    
    // ===== Helpers =====
    
    _cacheNormalizedSunVectors() { this.normalizedSunVectors = this.calculator.sunVectors.map(sv => new THREE.Vector3(sv.x, sv.y, sv.z).normalize()); }
    
    /**
     * Проверка финального состояния инсоляции после построения горки
     */
    _verifyFinalState(existingPoints) {
        console.log('[SolarPotential] === ВЕРИФИКАЦИЯ ФИНАЛЬНОГО СОСТОЯНИЯ ===');
        
        // Сбрасываем кэш для чистой проверки
        this.calculator.invalidateObstaclesCache();
        
        let pass = 0, warn = 0, fail = 0;
        let degradedToWarn = 0, degradedToFail = 0;
        
        for (let i = 0; i < existingPoints.length; i++) {
            const result = this.calculator.calculatePoint(existingPoints[i], null, 120, i === 0);
            const newStatus = result ? result.evaluation.status : 'PASS';
            const baselineStatus = this.baselineStatus.get(i);
            
            if (newStatus === 'PASS') pass++;
            else if (newStatus === 'WARNING') warn++;
            else fail++;
            
            // Проверяем деградацию
            if (baselineStatus === 'PASS' && newStatus === 'WARNING') degradedToWarn++;
            if (baselineStatus !== 'FAIL' && newStatus === 'FAIL') degradedToFail++;
        }
        
        console.log(`[SolarPotential] ПОСЛЕ горки: 🟢${pass} 🟡${warn} 🔴${fail}`);
        
        if (degradedToWarn > 0 || degradedToFail > 0) {
            console.log(`[SolarPotential] ⚠️ ДЕГРАДАЦИЯ: ${degradedToWarn} стали WARNING, ${degradedToFail} стали FAIL`);
            console.log(`[SolarPotential] Это может означать что колонки не были откачены вовремя!`);
        } else {
            console.log(`[SolarPotential] ✅ Инсоляция не ухудшилась`);
        }
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
        
        console.log(`[SolarPotential] Baseline (ДО горки): 🟢${pass} 🟡${warn} 🔴${fail} из ${existingPoints.length} точек`);
        
        if (fail > 0) {
            console.log(`[SolarPotential] ⚠️ ${fail} точек УЖЕ в FAIL до построения горки!`);
        }
    }
    
    _getExistingBuildingPoints() {
        if (!this.insolationGrid) return [];
        const activeMesh = this.insolationGrid.getActiveMesh();
        if (activeMesh?.userData?.subtype?.includes('solar-potential')) return [];
        return this.insolationGrid.getCalculationPoints();
    }
    
    _calculateStats() {
        const active = this.columns.filter(c => c.height > 0 && c.mesh);
        let totalVolume = 0, maxHeight = 0, safeCount = 0, warningCount = 0, failCount = 0;
        for (const col of active) {
            const height = col.height;
            const area = col.area || (this.cellSize * this.cellSize);
            totalVolume += area * height;
            maxHeight = Math.max(maxHeight, height);
            if (col.violationType === 'fail') failCount++;
            else if (col.violationType === 'warning') warningCount++;
            else safeCount++;
        }
        return { columnCount: active.length, safeCount, warningCount, failCount, totalVolume, maxHeight };
    }
    
    _clearTempMeshes() {
        const group = this.sceneManager.getBuildingsGroup();
        for (const mesh of this.tempMeshes) { group.remove(mesh); if (mesh.geometry) mesh.geometry.dispose(); if (mesh.material) mesh.material.dispose(); }
        this.tempMeshes = [];
        this.meshToColumnMap.clear();
        this.savedColors.clear();
    }
    
    clear() {
        this.cancel();
        this._clearTempMeshes();
        this._clearGridPreview();
        this._hideControlPanel();
        this.clearFinalized();
        const group = this.sceneManager.getBuildingsGroup();
        if (this.groundOutline) { group.remove(this.groundOutline); this.groundOutline.geometry?.dispose(); this.groundOutline.material?.dispose(); this.groundOutline = null; }
        this.columns = [];
        this._originalPolygon = null;
        this.baselineStatus.clear();
        this.previousStatus.clear();
        this.isLocked = false;
        this.isRayBlocked = false;
        this.isGhostMode = false;
        this.isHidden = false;
        this.isFootprintHidden = false;
        this.isFinalized = false;
        this.envelopeData = null;
        if (this.calculator) this.calculator.invalidateObstaclesCache();
    }
    
    cancel() {
        this.isCancelled = true;
        this._hideProgress();
        this._clearGridPreview();
        if (this.settingsDialog) { this.settingsDialog.remove(); this.settingsDialog = null; }
    }
    
    _sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
    
    // ===== ФИНАЛИЗАЦИЯ =====
    
    finalize() {
        if (this.columns.length === 0) return false;
        if (this.isFinalized) return false;
        
        this.isLocked = true;
        this.isFinalized = true;
        
        this._buildEnvelopeData();
        this._hideAllColumns();
        this._createTopSurfaceMesh();
        this._createGroundHeightGrid();
        this._showControlPanel();
        
        window.dispatchEvent(new CustomEvent('envelope-finalized', { detail: { envelope: this, envelopeData: this.envelopeData } }));
        
        return true;
    }
    
    _buildEnvelopeData() {
        const heights = new Map();
        const columns2D = new Map();
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        for (const col of this.columns) {
            if (col.height <= 0) continue;
            minX = Math.min(minX, col.x); minY = Math.min(minY, col.y);
            maxX = Math.max(maxX, col.x); maxY = Math.max(maxY, col.y);
        }
        
        const gridOriginX = minX - this.cellSize / 2;
        const gridOriginY = minY - this.cellSize / 2;
        let minRow = Infinity, minCol = Infinity, maxRow = -Infinity, maxCol = -Infinity;
        
        for (const col of this.columns) {
            if (col.height <= 0) continue;
            const gridCol = Math.round((col.x - gridOriginX) / this.cellSize);
            const gridRow = Math.round((col.y - gridOriginY) / this.cellSize);
            const key = `${gridRow},${gridCol}`;
            heights.set(key, col.height);
            columns2D.set(key, col);
            minRow = Math.min(minRow, gridRow); minCol = Math.min(minCol, gridCol);
            maxRow = Math.max(maxRow, gridRow); maxCol = Math.max(maxCol, gridCol);
        }
        
        this.envelopeData = { cellSize: this.cellSize, heightStep: this.heightStep, maxHeight: this.maxHeight, gridAngle: this.gridAngle, origin: { x: gridOriginX, y: gridOriginY }, bounds: { minX, minY, maxX, maxY }, gridBounds: { minRow, minCol, maxRow, maxCol }, rows: maxRow - minRow + 1, cols: maxCol - minCol + 1, heights, columns2D, columnCount: heights.size, originalPolygon: this._originalPolygon };
        this._envelopeOrigin = { x: gridOriginX, y: gridOriginY };
    }
    
    getHeightAt(x, y) { if (!this.envelopeData) return 0; const col = Math.round((x - this._envelopeOrigin.x) / this.cellSize); const row = Math.round((y - this._envelopeOrigin.y) / this.cellSize); return this.envelopeData.heights.get(`${row},${col}`) || 0; }
    getEnvelopeData() { if (!this.isFinalized) return null; return this.envelopeData; }
    
    _hideAllColumns() { for (const col of this.columns) { if (col.mesh) col.mesh.visible = false; } }
    _showAllColumns() { for (const col of this.columns) { if (col.mesh && col.height > 0) col.mesh.visible = true; } }
    
    _createTopSurfaceMesh() {
        if (this.topSurfaceMesh) { this.sceneManager.getBuildingsGroup().remove(this.topSurfaceMesh); this.topSurfaceMesh.geometry?.dispose(); this.topSurfaceMesh.material?.dispose(); this.topSurfaceMesh = null; }
        
        const activeColumns = this.columns.filter(c => c.height > 0 && c.clippedPolygon);
        if (activeColumns.length === 0) return;
        
        const positions = [], colors = [], indices = [];
        let vertexIndex = 0;
        
        for (const col of activeColumns) {
            const polygon = col.clippedPolygon;
            if (!polygon || polygon.length < 3) continue;
            
            const z = col.height;
            const t = col.height / this.maxHeight;
            const color = this._heightToColorRGB(t);
            
            const firstVertex = vertexIndex;
            for (const p of polygon) { positions.push(p.x, p.y, z); colors.push(color.r, color.g, color.b); }
            for (let i = 1; i < polygon.length - 1; i++) {
                indices.push(firstVertex, firstVertex + i, firstVertex + i + 1);
            }
            vertexIndex += polygon.length;
        }
        
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        
        const material = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
        this.topSurfaceMesh = new THREE.Mesh(geometry, material);
        this.topSurfaceMesh.userData = { id: `envelope-top-${Date.now()}`, type: 'envelope', subtype: 'solar-potential-top', isEnvelope: true };
        this.sceneManager.getBuildingsGroup().add(this.topSurfaceMesh);
        
        this._createTopSurfaceWireframe(activeColumns);
    }
    
    _createTopSurfaceWireframe(activeColumns) {
        if (this.topSurfaceWireframe) { this.sceneManager.getBuildingsGroup().remove(this.topSurfaceWireframe); this.topSurfaceWireframe.geometry?.dispose(); this.topSurfaceWireframe.material?.dispose(); this.topSurfaceWireframe = null; }
        
        const positions = [];
        for (const col of activeColumns) {
            const polygon = col.clippedPolygon;
            if (!polygon || polygon.length < 3) continue;
            const z = col.height + 0.1;
            for (let i = 0; i < polygon.length; i++) {
                const p1 = polygon[i]; const p2 = polygon[(i + 1) % polygon.length];
                positions.push(p1.x, p1.y, z, p2.x, p2.y, z);
            }
        }
        
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const material = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 });
        this.topSurfaceWireframe = new THREE.LineSegments(geometry, material);
        this.sceneManager.getBuildingsGroup().add(this.topSurfaceWireframe);
    }
    
    _createGroundHeightGrid() {
        if (this.groundHeightGrid) { this.sceneManager.getBuildingsGroup().remove(this.groundHeightGrid); this.groundHeightGrid = null; }
        if (this.groundHeightLabels) { this.sceneManager.getBuildingsGroup().remove(this.groundHeightLabels); this.groundHeightLabels = null; }
        
        const activeColumns = this.columns.filter(c => c.height > 0 && c.clippedPolygon);
        if (activeColumns.length === 0) return;
        
        const group = new THREE.Group();
        const groundZ = 0.2;
        const gridPositions = [], fillPositions = [], fillColors = [], fillIndices = [];
        let vertexIndex = 0;
        
        for (const col of activeColumns) {
            const polygon = col.clippedPolygon;
            if (!polygon || polygon.length < 3) continue;
            
            for (let i = 0; i < polygon.length; i++) {
                const p1 = polygon[i]; const p2 = polygon[(i + 1) % polygon.length];
                gridPositions.push(p1.x, p1.y, groundZ, p2.x, p2.y, groundZ);
            }
            
            const t = col.height / this.maxHeight;
            const color = this._heightToColorRGB(t);
            const firstVertex = vertexIndex;
            for (const p of polygon) { fillPositions.push(p.x, p.y, groundZ); fillColors.push(color.r, color.g, color.b); }
            for (let i = 1; i < polygon.length - 1; i++) {
                fillIndices.push(firstVertex, firstVertex + i, firstVertex + i + 1);
            }
            vertexIndex += polygon.length;
        }
        
        const gridGeometry = new THREE.BufferGeometry();
        gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPositions, 3));
        group.add(new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({ color: 0x4caf50, transparent: true, opacity: 0.5 })));
        
        const fillGeometry = new THREE.BufferGeometry();
        fillGeometry.setAttribute('position', new THREE.Float32BufferAttribute(fillPositions, 3));
        fillGeometry.setAttribute('color', new THREE.Float32BufferAttribute(fillColors, 3));
        fillGeometry.setIndex(fillIndices);
        group.add(new THREE.Mesh(fillGeometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.4, side: THREE.DoubleSide })));
        
        this.groundHeightGrid = group;
        this.sceneManager.getBuildingsGroup().add(group);
        
        this._createHeightLabels(activeColumns);
    }
    
    _createHeightLabels(activeColumns) {
        const labelGroup = new THREE.Group();
        const step = this.cellSize <= 6 ? 4 : (this.cellSize <= 12 ? 3 : 2);
        const byPosition = new Map();
        for (const col of activeColumns) { const keyX = Math.round(col.x / (this.cellSize * step)); const keyY = Math.round(col.y / (this.cellSize * step)); const key = `${keyX},${keyY}`; if (!byPosition.has(key)) byPosition.set(key, col); }
        for (const col of byPosition.values()) { const sprite = this._createTextSprite(`${Math.round(col.height)}`, col.x, col.y); if (sprite) labelGroup.add(sprite); }
        this.groundHeightLabels = labelGroup;
        this.sceneManager.getBuildingsGroup().add(labelGroup);
    }
    
    _createTextSprite(text, x, y) {
        const canvas = document.createElement('canvas');
        const size = 32;
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.beginPath(); ctx.arc(size/2, size/2, size/2 - 2, 0, Math.PI * 2); ctx.fill();
        ctx.font = 'bold 14px Arial'; ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, size / 2, size / 2);
        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
        const sprite = new THREE.Sprite(material);
        sprite.position.set(x, y, 1);
        sprite.scale.set(this.cellSize * 0.4, this.cellSize * 0.4, 1);
        return sprite;
    }
    
    _heightToColorRGB(t) {
        let r, g, b;
        if (t < 0.25) { const s = t / 0.25; r = 0.1; g = 0.3 + s * 0.4; b = 0.8 - s * 0.3; }
        else if (t < 0.5) { const s = (t - 0.25) / 0.25; r = 0.1 + s * 0.2; g = 0.7 - s * 0.1; b = 0.5 - s * 0.3; }
        else if (t < 0.75) { const s = (t - 0.5) / 0.25; r = 0.3 + s * 0.7; g = 0.6 + s * 0.3; b = 0.2 - s * 0.1; }
        else { const s = (t - 0.75) / 0.25; r = 1.0; g = 0.9 - s * 0.6; b = 0.1; }
        return { r, g, b };
    }
    
    unfinalize() {
        if (!this.isFinalized) return;
        const group = this.sceneManager.getBuildingsGroup();
        if (this.topSurfaceMesh) { group.remove(this.topSurfaceMesh); this.topSurfaceMesh.geometry?.dispose(); this.topSurfaceMesh.material?.dispose(); this.topSurfaceMesh = null; }
        if (this.topSurfaceWireframe) { group.remove(this.topSurfaceWireframe); this.topSurfaceWireframe.geometry?.dispose(); this.topSurfaceWireframe.material?.dispose(); this.topSurfaceWireframe = null; }
        if (this.groundHeightGrid) { group.remove(this.groundHeightGrid); this.groundHeightGrid = null; }
        if (this.groundHeightLabels) { group.remove(this.groundHeightLabels); this.groundHeightLabels = null; }
        this._showAllColumns();
        this.isLocked = false;
        this.isFinalized = false;
        this.envelopeData = null;
        this._showControlPanel();
    }
    
    toggleFinalizedVisibility() {
        this.isHidden = !this.isHidden;
        if (this.topSurfaceMesh) this.topSurfaceMesh.visible = !this.isHidden;
        if (this.topSurfaceWireframe) this.topSurfaceWireframe.visible = !this.isHidden;
        if (this.groundHeightGrid) this.groundHeightGrid.visible = !this.isHidden;
        if (this.groundHeightLabels) this.groundHeightLabels.visible = !this.isHidden;
        if (this.groundOutline && !this.isFootprintHidden) this.groundOutline.visible = !this.isHidden;
    }
    
    clearFinalized() {
        const group = this.sceneManager.getBuildingsGroup();
        if (this.topSurfaceMesh) { group.remove(this.topSurfaceMesh); this.topSurfaceMesh.geometry?.dispose(); this.topSurfaceMesh.material?.dispose(); this.topSurfaceMesh = null; }
        if (this.topSurfaceWireframe) { group.remove(this.topSurfaceWireframe); this.topSurfaceWireframe.geometry?.dispose(); this.topSurfaceWireframe.material?.dispose(); this.topSurfaceWireframe = null; }
        if (this.groundHeightGrid) { group.remove(this.groundHeightGrid); this.groundHeightGrid = null; }
        if (this.groundHeightLabels) { group.remove(this.groundHeightLabels); this.groundHeightLabels = null; }
        this.isFinalized = false;
        this.envelopeData = null;
    }
}

export { SolarPotential };
window.SolarPotential = SolarPotential;