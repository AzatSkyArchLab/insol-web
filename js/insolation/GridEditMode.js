/**
 * GridEditMode.js
 * Режим редактирования инсоляционной сетки
 * 
 * Фичи:
 * - Backface culling (вектор от здания к камере)
 * - Горячие клавиши (Shift+клик, Ctrl+клик, Del)
 * - unprojectToFace для точного определения позиции клика
 * - Режимы: рёбра / ячейки
 * - Pop-up панель
 */

class GridEditMode {
    constructor(insolationGrid) {
        this.grid = insolationGrid;
        this.sceneManager = insolationGrid.sceneManager;
        this.scene = insolationGrid.scene;
        this.camera = insolationGrid.camera;
        this.renderer = insolationGrid.renderer;
        
        this.enabled = false;
        this.activeMesh = null;
        
        // Состояние
        this.isDragging = false;
        this.dragData = null;
        this.dragStart = null;
        this.dragAccum = { x: 0, y: 0 };  // Для определения направления corner drag
        this.activeFace = null;           // 'left' или 'right' для corner
        this.hoveredEdge = null;
        this.selectedEdge = null;
        
        // Видимые фасады
        this.visibleFaces = new Set();
        this._lastVisibleStr = '';  // Для логирования изменений
        
        // Режим: 'edges' или 'cells'
        this.editMode = 'edges';
        
        // Выбранные ячейки
        this.selectedCells = new Set();
        this.cells = [];
        
        // Данные о рёбрах
        this.edges = [];
        
        // Исходное состояние
        this.originalCustomGrid = null;
        this.originalLocalPoints = null;
        
        // Материалы для подсветки
        this.materials = {
            hover: new THREE.LineBasicMaterial({ color: 0x00ffff }),
            drag: new THREE.LineBasicMaterial({ color: 0xffff00 }),
            selected: new THREE.LineBasicMaterial({ color: 0x00ff88 })
        };
        
        // Группа для объектов подсветки (corner edges)
        this.highlightGroup = null;
        
        // Pop-up панель
        this.panel = null;
        
        // Event handlers
        this._onMouseDown = this._handleMouseDown.bind(this);
        this._onMouseMove = this._handleMouseMove.bind(this);
        this._onMouseUp = this._handleMouseUp.bind(this);
        this._onKeyDown = this._handleKeyDown.bind(this);
        
        // Callbacks
        this.onGridChanged = null;
    }
    
    enable(mesh) {
        if (this.enabled) this.disable();
        
        console.log('[GridEditMode] === ENABLE ===');
        
        this.activeMesh = mesh;
        this.enabled = true;
        
        this._saveOriginalState(mesh);
        this._ensureCustomGrid(mesh);
        
        this.grid.createGridWithCustomLayout(mesh);
        this.grid.setPointsVisible(false);
        
        // Создаём группу для подсветки
        this.highlightGroup = new THREE.Group();
        this.highlightGroup.name = 'gridEditHighlight';
        this.scene.add(this.highlightGroup);
        
        this._updateVisibleFaces();
        this._buildEdges();
        this._buildCells();
        
        if (this.sceneManager.controls) {
            this.sceneManager.controls.enabled = false;
        }
        
        this._createPanel();
        
        this.renderer.domElement.addEventListener('mousedown', this._onMouseDown);
        this.renderer.domElement.addEventListener('mousemove', this._onMouseMove);
        this.renderer.domElement.addEventListener('mouseup', this._onMouseUp);
        this.renderer.domElement.addEventListener('mouseleave', this._onMouseUp);
        document.addEventListener('keydown', this._onKeyDown, true);  // capture: true - выполняется первым!
        
        console.log('[GridEditMode] Рёбер:', this.edges.length, 
            'Видимых фасадов:', this.visibleFaces.size);
    }
    
    /**
     * Вызывается при изменении высоты здания
     */
    onHeightChanged() {
        if (!this.enabled || !this.activeMesh) {
            console.log('[GridEditMode] onHeightChanged: не активен или нет mesh');
            return;
        }
        
        const mesh = this.activeMesh;
        const newHeight = mesh.userData.properties?.height || 9;
        const customGrid = mesh.userData.customGrid;
        
        if (!customGrid) {
            console.log('[GridEditMode] onHeightChanged: нет customGrid');
            return;
        }
        
        // Получаем текущую максимальную высоту из первого фасада
        const firstFacade = customGrid.facades.find(f => f);
        const oldHeight = firstFacade ? firstFacade.horizontalLines[firstFacade.horizontalLines.length - 1] : 0;
        
        console.log('[GridEditMode] onHeightChanged: старая высота =', oldHeight, 'новая =', newHeight);
        
        // Обновляем горизонтальные линии для всех фасадов
        for (const facade of customGrid.facades) {
            if (!facade) continue;
            
            // Получаем текущую максимальную высоту этого фасада
            const currentMax = facade.horizontalLines[facade.horizontalLines.length - 1];
            
            if (newHeight > currentMax) {
                // Высота увеличилась - просто обновляем верхнюю границу
                facade.horizontalLines[facade.horizontalLines.length - 1] = newHeight;
            } else if (newHeight < currentMax) {
                // Высота уменьшилась - фильтруем линии и обновляем верхнюю границу
                facade.horizontalLines = facade.horizontalLines.filter(z => z < newHeight);
                facade.horizontalLines.push(newHeight);
            }
            // Если высота не изменилась - ничего не делаем
            
            // Убеждаемся что 0 есть в начале
            if (facade.horizontalLines[0] !== 0) {
                facade.horizontalLines.unshift(0);
            }
            
            facade.horizontalLines.sort((a, b) => a - b);
        }
        
        console.log('[GridEditMode] onHeightChanged: пересоздаю сетку');
        this._rebuild();
    }
    
    disable() {
        if (!this.enabled) return;
        
        console.log('[GridEditMode] === DISABLE ===');
        
        this.enabled = false;
        
        this.renderer.domElement.removeEventListener('mousedown', this._onMouseDown);
        this.renderer.domElement.removeEventListener('mousemove', this._onMouseMove);
        this.renderer.domElement.removeEventListener('mouseup', this._onMouseUp);
        this.renderer.domElement.removeEventListener('mouseleave', this._onMouseUp);
        document.removeEventListener('keydown', this._onKeyDown, true);  // capture: true
        
        this._restoreAllMaterials();
        this._clearHighlight();
        this._removePanel();
        
        // Удаляем группу подсветки
        if (this.highlightGroup) {
            this.scene.remove(this.highlightGroup);
            this.highlightGroup = null;
        }
        
        if (this.sceneManager.controls) {
            this.sceneManager.controls.enabled = true;
        }
        
        this.renderer.domElement.style.cursor = 'default';
        
        this.edges = [];
        this.cells = [];
        this.selectedCells.clear();
        this.visibleFaces.clear();
        this.activeMesh = null;
        this.isDragging = false;
        this.dragData = null;
        this.dragAccum = { x: 0, y: 0 };
        this.activeFace = null;
        this.hoveredEdge = null;
        this.selectedEdge = null;
        this.originalCustomGrid = null;
        this.originalLocalPoints = null;
    }
    
    isEnabled() { return this.enabled; }
    
    applyChanges() {
        if (!this.activeMesh) return;
        this.grid.setPointsVisible(true);
        if (this.onGridChanged) this.onGridChanged(this.activeMesh);
        this.disable();
    }
    
    cancelChanges() {
        if (!this.activeMesh) return;
        
        // Восстанавливаем customGrid
        if (this.originalCustomGrid) {
            this.activeMesh.userData.customGrid = JSON.parse(JSON.stringify(this.originalCustomGrid));
        } else {
            delete this.activeMesh.userData.customGrid;
        }
        
        // Восстанавливаем геометрию mesh из оригинальных точек
        if (this.originalLocalPoints && this.originalLocalPoints.length >= 3) {
            this._rebuildMeshGeometry(this.originalLocalPoints);
        }
        
        this.grid.createGridWithCustomLayout(this.activeMesh);
        this.grid.setPointsVisible(true);
        this.disable();
    }
    
    resetToUniform() {
        if (!this.activeMesh) return;
        delete this.activeMesh.userData.customGrid;
        this._ensureCustomGrid(this.activeMesh);
        this._rebuild();
    }
    
    // ==================== Видимые фасады ====================
    
    _updateVisibleFaces() {
        this.visibleFaces.clear();
        
        const mesh = this.activeMesh;
        const customGrid = mesh.userData.customGrid;
        if (!customGrid) return;
        
        const pos = mesh.position;
        const rot = mesh.rotation.z || 0;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        
        // Позиция камеры
        const camX = this.camera.position.x;
        const camY = this.camera.position.y;
        
        // Центр здания в мировых координатах (для определения "внутри/снаружи")
        let localCenterX = 0, localCenterY = 0, count = 0;
        for (const facade of customGrid.facades) {
            if (!facade) continue;
            localCenterX += facade.start.x;
            localCenterY += facade.start.y;
            count++;
        }
        if (count > 0) {
            localCenterX /= count;
            localCenterY /= count;
        }
        const worldCenterX = localCenterX * cos - localCenterY * sin + pos.x;
        const worldCenterY = localCenterX * sin + localCenterY * cos + pos.y;
        
        // Горизонтальное расстояние от камеры до центра здания
        const horizDist = Math.hypot(camX - worldCenterX, camY - worldCenterY);
        
        // Если камера почти строго сверху (горизонтальное расстояние очень мало)
        // то показываем все фасады
        if (horizDist < 1) {
            for (let fi = 0; fi < customGrid.facades.length; fi++) {
                if (customGrid.facades[fi] && customGrid.facades[fi].edgeLength >= 0.01) {
                    this.visibleFaces.add(fi);
                }
            }
            return;
        }
        
        for (let fi = 0; fi < customGrid.facades.length; fi++) {
            const facade = customGrid.facades[fi];
            if (!facade) continue;
            
            const { start, end, edgeLength } = facade;
            if (edgeLength < 0.01) continue;
            
            // Направление ребра в локальных координатах
            const edgeDirX = (end.x - start.x) / edgeLength;
            const edgeDirY = (end.y - start.y) / edgeLength;
            
            // Перпендикуляр к ребру (потенциальная нормаль наружу)
            // Два варианта: (-edgeDirY, edgeDirX) или (edgeDirY, -edgeDirX)
            let normalX = -edgeDirY;
            let normalY = edgeDirX;
            
            // Центр фасада в локальных координатах
            const facadeMidX = (start.x + end.x) / 2;
            const facadeMidY = (start.y + end.y) / 2;
            
            // Проверяем, направлена ли нормаль наружу (от центра здания)
            const toFacadeX = facadeMidX - localCenterX;
            const toFacadeY = facadeMidY - localCenterY;
            const dotWithCenter = normalX * toFacadeX + normalY * toFacadeY;
            
            // Если нормаль направлена внутрь - инвертируем
            if (dotWithCenter < 0) {
                normalX = -normalX;
                normalY = -normalY;
            }
            
            // Преобразуем нормаль в мировые координаты
            const worldNormalX = normalX * cos - normalY * sin;
            const worldNormalY = normalX * sin + normalY * cos;
            
            // Центр фасада в мировых координатах
            const worldFacadeMidX = facadeMidX * cos - facadeMidY * sin + pos.x;
            const worldFacadeMidY = facadeMidX * sin + facadeMidY * cos + pos.y;
            
            // Вектор от центра фасада к камере
            const toCamX = camX - worldFacadeMidX;
            const toCamY = camY - worldFacadeMidY;
            const toCamLen = Math.hypot(toCamX, toCamY);
            
            if (toCamLen < 0.01) {
                this.visibleFaces.add(fi);
                continue;
            }
            
            // Dot product нормали и направления к камере
            const dot = worldNormalX * toCamX / toCamLen + worldNormalY * toCamY / toCamLen;
            
            // Фасад видим если камера смотрит на его внешнюю сторону (dot > 0)
            if (dot > 0) {
                this.visibleFaces.add(fi);
            }
        }
        
        // Fallback
        if (this.visibleFaces.size === 0) {
            for (let fi = 0; fi < customGrid.facades.length; fi++) {
                if (customGrid.facades[fi] && customGrid.facades[fi].edgeLength >= 0.01) {
                    this.visibleFaces.add(fi);
                }
            }
        }
        
        // Логируем только если набор изменился
        const visibleStr = Array.from(this.visibleFaces).sort((a,b) => a-b).join(',');
        if (visibleStr !== this._lastVisibleStr) {
            this._lastVisibleStr = visibleStr;
            const total = customGrid.facades.filter(f => f).length;
            console.log(`[GridEditMode] Видимые фасады: [${visibleStr}] из ${total}`);
        }
    }
    
    // ==================== Инициализация ====================
    
    _saveOriginalState(mesh) {
        if (mesh.userData.customGrid) {
            this.originalCustomGrid = JSON.parse(JSON.stringify(mesh.userData.customGrid));
        } else {
            this.originalCustomGrid = null;
        }
        
        // Сохраняем оригинальные точки геометрии
        this.originalLocalPoints = this.grid._extractLocalBasePoints(mesh);
    }
    
    _ensureCustomGrid(mesh) {
        if (mesh.userData.customGrid) return;
        
        const localPoints = this.grid._extractLocalBasePoints(mesh);
        if (!localPoints || localPoints.length < 3) return;
        
        const height = mesh.userData.properties?.height || 9;
        const facades = [];
        
        for (let i = 0; i < localPoints.length; i++) {
            const p1 = localPoints[i];
            const p2 = localPoints[(i + 1) % localPoints.length];
            const edgeLength = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
            
            if (edgeLength < 1) {
                facades.push(null);
                continue;
            }
            
            const hStep = this.grid.horizontalStep;
            let hSegments = Math.max(1, Math.round(edgeLength / hStep));
            if (edgeLength / hSegments > this.grid.horizontalMaxStep) {
                hSegments = Math.ceil(edgeLength / this.grid.horizontalMaxStep);
            }
            
            const verticalLines = [];
            for (let j = 0; j <= hSegments; j++) {
                verticalLines.push((j / hSegments) * edgeLength);
            }
            
            const vStep = this.grid.verticalStep;
            const levels = Math.floor(height / vStep);
            const horizontalLines = [];
            for (let j = 0; j <= levels; j++) {
                const z = j * vStep;
                if (z <= height) horizontalLines.push(z);
            }
            if (horizontalLines[horizontalLines.length - 1] < height) {
                horizontalLines.push(height);
            }
            
            facades.push({
                edgeLength,
                verticalLines,
                horizontalLines,
                start: { x: p1.x, y: p1.y },
                end: { x: p2.x, y: p2.y }
            });
        }
        
        mesh.userData.customGrid = { facades };
    }
    
    _buildEdges() {
        this.edges = [];
        
        const mesh = this.activeMesh;
        const customGrid = mesh.userData.customGrid;
        const meshGroup = this.grid.meshGroups.get(mesh);
        
        if (!customGrid || !meshGroup) return;
        
        const pos = mesh.position;
        const rot = mesh.rotation.z || 0;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        
        let lineIdx = 0;
        
        for (let fi = 0; fi < customGrid.facades.length; fi++) {
            const facade = customGrid.facades[fi];
            if (!facade) continue;
            
            const { start, end, verticalLines, horizontalLines, edgeLength } = facade;
            const facadeHeight = horizontalLines[horizontalLines.length - 1];
            
            const dirX = (end.x - start.x) / edgeLength;
            const dirY = (end.y - start.y) / edgeLength;
            
            // Corner edge (угол здания)
            const cornerWorldX = start.x * cos - start.y * sin + pos.x;
            const cornerWorldY = start.x * sin + start.y * cos + pos.y;
            
            this.edges.push({
                type: 'corner',
                vertexIndex: fi,
                facadeIndex: fi,
                p1: { x: cornerWorldX, y: cornerWorldY, z: 0 },
                p2: { x: cornerWorldX, y: cornerWorldY, z: facadeHeight },
                localStart: { x: start.x, y: start.y }
            });
            
            // Вертикальные линии
            for (let vi = 0; vi < verticalLines.length; vi++) {
                const gridLine = meshGroup.lineObjects[lineIdx];
                lineIdx++;
                
                if (vi === 0 || vi === verticalLines.length - 1) continue;
                if (!gridLine) continue;  // Защита от undefined
                
                const t = verticalLines[vi];
                const localX = start.x + dirX * t;
                const localY = start.y + dirY * t;
                const worldX = localX * cos - localY * sin + pos.x;
                const worldY = localX * sin + localY * cos + pos.y;
                
                // Направление фасада в мировых координатах
                const worldDirX = dirX * cos - dirY * sin;
                const worldDirY = dirX * sin + dirY * cos;
                
                this.edges.push({
                    type: 'vertical',
                    facadeIndex: fi,
                    lineIndex: vi,
                    t: t / edgeLength,
                    gridLine: gridLine,
                    originalMaterial: gridLine.material ? gridLine.material.clone() : null,
                    p1: { x: worldX, y: worldY, z: 0 },
                    p2: { x: worldX, y: worldY, z: facadeHeight },
                    edgeLength: edgeLength,
                    facadeDir: { x: worldDirX, y: worldDirY }  // В мировых координатах!
                });
            }
            
            // Горизонтальные линии
            for (let hi = 0; hi < horizontalLines.length; hi++) {
                const gridLine = meshGroup.lineObjects[lineIdx];
                lineIdx++;
                
                if (hi === 0 || hi === horizontalLines.length - 1) continue;
                if (!gridLine) continue;  // Защита от undefined
                
                const z = horizontalLines[hi];
                
                const wx1 = start.x * cos - start.y * sin + pos.x;
                const wy1 = start.x * sin + start.y * cos + pos.y;
                const wx2 = end.x * cos - end.y * sin + pos.x;
                const wy2 = end.x * sin + end.y * cos + pos.y;
                
                this.edges.push({
                    type: 'horizontal',
                    facadeIndex: fi,
                    lineIndex: hi,
                    z: z,
                    gridLine: gridLine,
                    originalMaterial: gridLine.material ? gridLine.material.clone() : null,
                    p1: { x: wx1, y: wy1, z: z },
                    p2: { x: wx2, y: wy2, z: z },
                    maxZ: facadeHeight
                });
            }
        }
        
        console.log('[GridEditMode] Построено рёбер:', this.edges.length, 
            '(corners:', this.edges.filter(e => e.type === 'corner').length,
            'vertical:', this.edges.filter(e => e.type === 'vertical').length,
            'horizontal:', this.edges.filter(e => e.type === 'horizontal').length + ')');
    }
    
    _buildCells() {
        this.cells = [];
        
        const mesh = this.activeMesh;
        const customGrid = mesh.userData.customGrid;
        if (!customGrid) return;
        
        const pos = mesh.position;
        const rot = mesh.rotation.z || 0;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        
        for (let fi = 0; fi < customGrid.facades.length; fi++) {
            const facade = customGrid.facades[fi];
            if (!facade) continue;
            
            const { start, end, verticalLines, horizontalLines, edgeLength } = facade;
            const dirX = (end.x - start.x) / edgeLength;
            const dirY = (end.y - start.y) / edgeLength;
            
            for (let col = 0; col < verticalLines.length - 1; col++) {
                for (let row = 0; row < horizontalLines.length - 1; row++) {
                    const tCenter = (verticalLines[col] + verticalLines[col + 1]) / 2;
                    const zCenter = (horizontalLines[row] + horizontalLines[row + 1]) / 2;
                    
                    const localX = start.x + dirX * tCenter;
                    const localY = start.y + dirY * tCenter;
                    const worldX = localX * cos - localY * sin + pos.x;
                    const worldY = localX * sin + localY * cos + pos.y;
                    
                    this.cells.push({
                        facadeIndex: fi,
                        col, row,
                        cx: worldX, cy: worldY, cz: zCenter,
                        key: `${fi}-${col}-${row}`
                    });
                }
            }
        }
    }
    
    // ==================== Проекция ====================
    
    _project3DToScreen(point3D) {
        const vector = new THREE.Vector3(point3D.x, point3D.y, point3D.z);
        vector.project(this.camera);
        
        const rect = this.renderer.domElement.getBoundingClientRect();
        return {
            x: (vector.x * 0.5 + 0.5) * rect.width,
            y: (-vector.y * 0.5 + 0.5) * rect.height
        };
    }
    
    /**
     * Обратная проекция точки экрана на фасад
     */
    _unprojectToFace(screenX, screenY, faceIndex) {
        const mesh = this.activeMesh;
        const customGrid = mesh.userData.customGrid;
        const facade = customGrid.facades[faceIndex];
        if (!facade) return { t: 0.5, z: 0, dist: Infinity };
        
        const pos = mesh.position;
        const rot = mesh.rotation.z || 0;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        
        const { start, end, horizontalLines } = facade;
        const facadeHeight = horizontalLines[horizontalLines.length - 1];
        
        // 4 угла фасада в мировых координатах
        const p1 = {
            x: start.x * cos - start.y * sin + pos.x,
            y: start.x * sin + start.y * cos + pos.y
        };
        const p2 = {
            x: end.x * cos - end.y * sin + pos.x,
            y: end.x * sin + end.y * cos + pos.y
        };
        
        const s00 = this._project3DToScreen({ x: p1.x, y: p1.y, z: 0 });
        const s10 = this._project3DToScreen({ x: p2.x, y: p2.y, z: 0 });
        const s01 = this._project3DToScreen({ x: p1.x, y: p1.y, z: facadeHeight });
        const s11 = this._project3DToScreen({ x: p2.x, y: p2.y, z: facadeHeight });
        
        // Грубый поиск
        let bestT = 0.5, bestU = 0.5, bestDist = Infinity;
        
        for (let ti = 0; ti <= 40; ti++) {
            for (let ui = 0; ui <= 40; ui++) {
                const t = ti / 40, u = ui / 40;
                const sx = (1-t)*(1-u)*s00.x + t*(1-u)*s10.x + (1-t)*u*s01.x + t*u*s11.x;
                const sy = (1-t)*(1-u)*s00.y + t*(1-u)*s10.y + (1-t)*u*s01.y + t*u*s11.y;
                const dist = Math.hypot(sx - screenX, sy - screenY);
                if (dist < bestDist) { bestDist = dist; bestT = t; bestU = u; }
            }
        }
        
        // Уточнение
        for (let iter = 0; iter < 3; iter++) {
            const step = 0.025 / Math.pow(4, iter);
            for (let dt = -4; dt <= 4; dt++) {
                for (let du = -4; du <= 4; du++) {
                    const t = Math.max(0, Math.min(1, bestT + dt * step));
                    const u = Math.max(0, Math.min(1, bestU + du * step));
                    const sx = (1-t)*(1-u)*s00.x + t*(1-u)*s10.x + (1-t)*u*s01.x + t*u*s11.x;
                    const sy = (1-t)*(1-u)*s00.y + t*(1-u)*s10.y + (1-t)*u*s01.y + t*u*s11.y;
                    const dist = Math.hypot(sx - screenX, sy - screenY);
                    if (dist < bestDist) { bestDist = dist; bestT = t; bestU = u; }
                }
            }
        }
        
        return { t: bestT, z: bestU * facadeHeight, dist: bestDist };
    }
    
    _distPointToSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1, dy = y2 - y1;
        const len2 = dx * dx + dy * dy;
        if (len2 === 0) return Math.hypot(px - x1, py - y1);
        let t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
        return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    }
    
    /**
     * Сравнивает два edge по типу и индексу
     */
    _isSameEdge(e1, e2) {
        if (!e1 || !e2) return false;
        if (e1.type !== e2.type) return false;
        if (e1.type === 'corner') {
            return e1.vertexIndex === e2.vertexIndex;
        }
        return e1.facadeIndex === e2.facadeIndex && e1.lineIndex === e2.lineIndex;
    }
    
    _findNearestEdge(screenX, screenY) {
        let nearest = null;
        let minDist = 30;  // Увеличенный радиус
        
        const n = this.activeMesh?.userData.customGrid?.facades.length || 0;
        if (n === 0) return null;
        
        for (const edge of this.edges) {
            // Проверяем видимость
            if (edge.type === 'corner') {
                // Corner виден если виден любой из смежных фасадов
                const leftFace = (edge.vertexIndex - 1 + n) % n;
                const rightFace = edge.vertexIndex;
                const isVisible = this.visibleFaces.has(leftFace) || this.visibleFaces.has(rightFace);
                if (!isVisible) continue;
            } else {
                // Обычные рёбра — только если фасад виден
                if (!this.visibleFaces.has(edge.facadeIndex)) continue;
            }
            
            const s1 = this._project3DToScreen(edge.p1);
            const s2 = this._project3DToScreen(edge.p2);
            
            // Проверяем что точки на экране валидны
            if (!s1 || !s2 || isNaN(s1.x) || isNaN(s2.x)) continue;
            
            const dist = this._distPointToSegment(screenX, screenY, s1.x, s1.y, s2.x, s2.y);
            if (dist < minDist) {
                minDist = dist;
                nearest = edge;
            }
        }
        
        return nearest;
    }
    
    _findNearestFace(screenX, screenY) {
        let bestFace = -1;
        let bestDist = 100;  // Максимальная дистанция
        
        const customGrid = this.activeMesh.userData.customGrid;
        
        for (let fi = 0; fi < customGrid.facades.length; fi++) {
            // ТОЛЬКО видимые фасады!
            if (!this.visibleFaces.has(fi)) continue;
            
            const result = this._unprojectToFace(screenX, screenY, fi);
            if (result.dist < bestDist && result.t >= 0 && result.t <= 1) {
                bestDist = result.dist;
                bestFace = fi;
            }
        }
        
        return bestFace;
    }
    
    _findNearestCell(screenX, screenY) {
        let nearest = null;
        let minDist = 30;
        
        for (const cell of this.cells) {
            // ТОЛЬКО видимые фасады!
            if (!this.visibleFaces.has(cell.facadeIndex)) continue;
            
            const screenPos = this._project3DToScreen({ x: cell.cx, y: cell.cy, z: cell.cz });
            const dist = Math.hypot(screenX - screenPos.x, screenY - screenPos.y);
            if (dist < minDist) {
                minDist = dist;
                nearest = cell;
            }
        }
        
        return nearest;
    }
    
    _findHorizontalChain(edge) {
        if (edge.type !== 'horizontal') return [edge];
        return this.edges.filter(e => e.type === 'horizontal' && e.lineIndex === edge.lineIndex);
    }
    
    // ==================== Подсветка ====================
    
    _clearHighlight() {
        if (!this.highlightGroup) return;
        while (this.highlightGroup.children.length > 0) {
            const obj = this.highlightGroup.children[0];
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
            this.highlightGroup.remove(obj);
        }
    }
    
    _createHighlightCylinder(p1, p2, color, radius = 0.15) {
        const start = new THREE.Vector3(p1.x, p1.y, p1.z);
        const end = new THREE.Vector3(p2.x, p2.y, p2.z);
        const length = start.distanceTo(end);
        
        const geometry = new THREE.CylinderGeometry(radius, radius, length, 8);
        const material = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.8 });
        const cylinder = new THREE.Mesh(geometry, material);
        
        // Позиционируем цилиндр
        const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
        cylinder.position.copy(midpoint);
        
        // Ориентируем вдоль линии
        const direction = new THREE.Vector3().subVectors(end, start).normalize();
        const axis = new THREE.Vector3(0, 1, 0);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(axis, direction);
        cylinder.setRotationFromQuaternion(quaternion);
        
        return cylinder;
    }
    
    _highlightEdge(edge, material) {
        this._clearHighlight();
        
        const color = material.color.getHex();
        
        if (edge.type === 'corner') {
            // Corner edge - создаём цилиндр подсветки
            const cylinder = this._createHighlightCylinder(edge.p1, edge.p2, color, 0.2);
            this.highlightGroup.add(cylinder);
            
        } else if (edge.type === 'horizontal') {
            // Подсвечиваем все горизонтальные линии на этом уровне
            const chain = this._findHorizontalChain(edge);
            for (const e of chain) {
                if (this.visibleFaces.has(e.facadeIndex)) {
                    if (e.gridLine && e.gridLine.material) {
                        e.gridLine.material = material.clone();
                    }
                    // Также добавляем цилиндр для лучшей видимости
                    const cylinder = this._createHighlightCylinder(e.p1, e.p2, color, 0.1);
                    this.highlightGroup.add(cylinder);
                }
            }
        } else if (edge.type === 'vertical') {
            if (edge.gridLine && edge.gridLine.material) {
                edge.gridLine.material = material.clone();
            }
            // Добавляем цилиндр
            const cylinder = this._createHighlightCylinder(edge.p1, edge.p2, color, 0.1);
            this.highlightGroup.add(cylinder);
        }
    }
    
    _restoreEdge(edge) {
        this._clearHighlight();
        
        if (edge.type === 'horizontal') {
            const chain = this._findHorizontalChain(edge);
            for (const e of chain) {
                if (e.gridLine && e.originalMaterial) {
                    e.gridLine.material = e.originalMaterial.clone();
                }
            }
        } else if (edge.type === 'vertical') {
            if (edge.gridLine && edge.originalMaterial) {
                edge.gridLine.material = edge.originalMaterial.clone();
            }
        }
        // Corner edges не имеют gridLine - просто очищаем highlight
    }
    
    _restoreAllMaterials() {
        this._clearHighlight();
        for (const edge of this.edges) {
            if (edge.gridLine && edge.originalMaterial) {
                edge.gridLine.material = edge.originalMaterial.clone();
            }
        }
    }
    
    /**
     * Подсвечивает направление движения для corner edge
     */
    _highlightCornerDirection(vertexIndex, activeFace) {
        const customGrid = this.activeMesh.userData.customGrid;
        const n = customGrid.facades.length;
        const pos = this.activeMesh.position;
        const rot = this.activeMesh.rotation.z || 0;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        
        // Получаем соответствующий фасад
        const faceIndex = activeFace === 'left' 
            ? (vertexIndex - 1 + n) % n 
            : vertexIndex;
        const facade = customGrid.facades[faceIndex];
        if (!facade) return;
        
        const { start, end, horizontalLines } = facade;
        const facadeHeight = horizontalLines[horizontalLines.length - 1];
        
        // Мировые координаты начала и конца фасада
        const wx1 = start.x * cos - start.y * sin + pos.x;
        const wy1 = start.x * sin + start.y * cos + pos.y;
        const wx2 = end.x * cos - end.y * sin + pos.x;
        const wy2 = end.x * sin + end.y * cos + pos.y;
        
        // Создаём подсветку фасада (полупрозрачная плоскость)
        const geometry = new THREE.PlaneGeometry(1, 1);
        const material = new THREE.MeshBasicMaterial({ 
            color: 0x00ff00, 
            transparent: true, 
            opacity: 0.3,
            side: THREE.DoubleSide,
            depthTest: false
        });
        const plane = new THREE.Mesh(geometry, material);
        
        // Позиционируем плоскость
        const cx = (wx1 + wx2) / 2;
        const cy = (wy1 + wy2) / 2;
        const cz = facadeHeight / 2;
        plane.position.set(cx, cy, cz);
        
        // Масштаб по ширине и высоте фасада
        const facadeWidth = Math.hypot(wx2 - wx1, wy2 - wy1);
        plane.scale.set(facadeWidth, facadeHeight, 1);
        
        // Поворачиваем к фасаду
        const angle = Math.atan2(wy2 - wy1, wx2 - wx1);
        plane.rotation.z = angle;
        plane.rotation.x = Math.PI / 2;
        
        this.highlightGroup.add(plane);
    }
    
    // ==================== Операции ====================
    
    _addVerticalLine(facadeIndex, t) {
        const customGrid = this.activeMesh.userData.customGrid;
        const facade = customGrid.facades[facadeIndex];
        if (!facade) return false;
        
        const pos = t * facade.edgeLength;
        
        console.log('[GridEditMode] + вертикальная линия: t=', t.toFixed(3), 'pos=', pos.toFixed(2), 'edgeLength=', facade.edgeLength.toFixed(2));
        
        for (const existing of facade.verticalLines) {
            if (Math.abs(existing - pos) < 0.5) {
                console.log('[GridEditMode] Слишком близко к существующей линии:', existing.toFixed(2));
                return false;
            }
        }
        
        facade.verticalLines.push(pos);
        facade.verticalLines.sort((a, b) => a - b);
        
        // Находим индекс нового ребра
        const newLineIndex = facade.verticalLines.indexOf(pos);
        
        this._rebuild();
        
        // Выделяем новое ребро
        const newEdge = this.edges.find(e => 
            e.type === 'vertical' && e.facadeIndex === facadeIndex && e.lineIndex === newLineIndex
        );
        if (newEdge) {
            this.selectedEdge = newEdge;
            this._highlightEdge(newEdge, this.materials.selected);
        }
        
        return true;
    }
    
    _addHorizontalLine(z) {
        const customGrid = this.activeMesh.userData.customGrid;
        
        console.log('[GridEditMode] + горизонтальная линия: z=', z.toFixed(2));
        
        for (const facade of customGrid.facades) {
            if (!facade) continue;
            for (const existing of facade.horizontalLines) {
                if (Math.abs(existing - z) < 0.3) {
                    console.log('[GridEditMode] Слишком близко к существующей линии:', existing.toFixed(2));
                    return false;
                }
            }
        }
        
        // Запоминаем z для поиска нового ребра
        const targetZ = z;
        
        for (const facade of customGrid.facades) {
            if (!facade) continue;
            facade.horizontalLines.push(z);
            facade.horizontalLines.sort((a, b) => a - b);
        }
        
        // Находим индекс нового ребра (в первом фасаде)
        const firstFacade = customGrid.facades.find(f => f);
        const newLineIndex = firstFacade ? firstFacade.horizontalLines.indexOf(targetZ) : -1;
        
        this._rebuild();
        
        // Выделяем новое ребро (берём первое найденное)
        if (newLineIndex >= 0) {
            const newEdge = this.edges.find(e => 
                e.type === 'horizontal' && e.lineIndex === newLineIndex
            );
            if (newEdge) {
                this.selectedEdge = newEdge;
                this._highlightEdge(newEdge, this.materials.selected);
            }
        }
        
        return true;
    }
    
    /**
     * Перераспределяет вертикальные линии с шагом 3-3.3м
     */
    _redistributeVerticalLines(facade) {
        if (!facade || facade.edgeLength < 0.1) return;
        
        const length = facade.edgeLength;
        const minStep = 3.0;
        const maxStep = 3.3;
        
        // Вычисляем оптимальное количество секций
        const minSections = Math.ceil(length / maxStep);
        const maxSections = Math.floor(length / minStep);
        
        let sections = Math.max(1, minSections);
        if (sections > maxSections && maxSections >= 1) {
            sections = maxSections;
        }
        
        // Равномерно распределяем линии
        const step = length / sections;
        const newLines = [0];
        for (let i = 1; i < sections; i++) {
            newLines.push(i * step);
        }
        newLines.push(length);
        
        facade.verticalLines = newLines;
    }
    
    /**
     * Масштабирует вертикальные линии пропорционально при изменении длины фасада
     */
    _scaleVerticalLines(facade, oldLength) {
        if (!facade || oldLength < 0.01 || facade.edgeLength < 0.01) return;
        
        const scale = facade.edgeLength / oldLength;
        const newLength = facade.edgeLength;
        
        // Масштабируем все линии пропорционально
        for (let i = 0; i < facade.verticalLines.length; i++) {
            facade.verticalLines[i] *= scale;
        }
        
        // Убеждаемся что первая = 0, последняя = newLength
        facade.verticalLines[0] = 0;
        facade.verticalLines[facade.verticalLines.length - 1] = newLength;
        
        // Удаляем линии которые стали слишком близко друг к другу (< 0.3м)
        const minGap = 0.3;
        const filtered = [0];
        for (let i = 1; i < facade.verticalLines.length - 1; i++) {
            const pos = facade.verticalLines[i];
            const prevPos = filtered[filtered.length - 1];
            if (pos - prevPos >= minGap && newLength - pos >= minGap) {
                filtered.push(pos);
            }
        }
        filtered.push(newLength);
        
        facade.verticalLines = filtered;
    }
    
    _deleteSelectedEdge() {
        if (!this.selectedEdge) return false;
        
        const customGrid = this.activeMesh.userData.customGrid;
        const edge = this.selectedEdge;
        
        if (edge.type === 'corner') {
            // Удаление угла = удаление вершины полигона
            const n = customGrid.facades.length;
            if (n <= 3) {
                console.log('[GridEditMode] Нельзя удалить: минимум 3 вершины');
                return false;
            }
            
            const vi = edge.vertexIndex;
            console.log('[GridEditMode] Удаление вершины', vi);
            
            // Получаем все точки из customGrid
            const localPoints = [];
            for (let i = 0; i < customGrid.facades.length; i++) {
                const f = customGrid.facades[i];
                if (f && f.start) {
                    localPoints.push({ x: f.start.x, y: f.start.y });
                }
            }
            
            // Удаляем вершину
            localPoints.splice(vi, 1);
            
            if (localPoints.length >= 3) {
                // Пересоздаём customGrid и геометрию
                this._rebuildCustomGridFromPoints(localPoints);
                this._rebuildMeshGeometry(localPoints);
            }
            
        } else if (edge.type === 'vertical') {
            const facade = customGrid.facades[edge.facadeIndex];
            if (!facade) return false;
            
            const vi = edge.lineIndex;
            if (vi > 0 && vi < facade.verticalLines.length - 1) {
                facade.verticalLines.splice(vi, 1);
                console.log('[GridEditMode] - вертикальная линия');
            }
        } else if (edge.type === 'horizontal') {
            const hi = edge.lineIndex;
            for (const f of customGrid.facades) {
                if (f && hi > 0 && hi < f.horizontalLines.length - 1) {
                    f.horizontalLines.splice(hi, 1);
                }
            }
            console.log('[GridEditMode] - горизонтальная линия');
        }
        
        this.selectedEdge = null;
        this._rebuild();
        return true;
    }
    
    _rebuildCustomGridFromPoints(localPoints) {
        const mesh = this.activeMesh;
        const height = mesh.userData.properties?.height || 9;
        const facades = [];
        
        for (let i = 0; i < localPoints.length; i++) {
            const p1 = localPoints[i];
            const p2 = localPoints[(i + 1) % localPoints.length];
            const edgeLength = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            
            if (edgeLength < 1) {
                facades.push(null);
                continue;
            }
            
            const hStep = this.grid.horizontalStep;
            let hSegments = Math.max(1, Math.round(edgeLength / hStep));
            if (edgeLength / hSegments > this.grid.horizontalMaxStep) {
                hSegments = Math.ceil(edgeLength / this.grid.horizontalMaxStep);
            }
            
            const verticalLines = [];
            for (let j = 0; j <= hSegments; j++) {
                verticalLines.push((j / hSegments) * edgeLength);
            }
            
            const vStep = this.grid.verticalStep;
            const levels = Math.floor(height / vStep);
            const horizontalLines = [];
            for (let j = 0; j <= levels; j++) {
                const z = j * vStep;
                if (z <= height) horizontalLines.push(z);
            }
            if (horizontalLines[horizontalLines.length - 1] < height) {
                horizontalLines.push(height);
            }
            
            facades.push({
                edgeLength,
                verticalLines,
                horizontalLines,
                start: { x: p1.x, y: p1.y },
                end: { x: p2.x, y: p2.y }
            });
        }
        
        mesh.userData.customGrid = { facades };
    }
    
    _rebuildMeshGeometry(localPoints) {
        // Пересоздаём геометрию mesh
        const mesh = this.activeMesh;
        const height = mesh.userData.properties?.height || 9;
        
        // Создаём новый Shape
        const shape = new THREE.Shape();
        shape.moveTo(localPoints[0].x, localPoints[0].y);
        for (let i = 1; i < localPoints.length; i++) {
            shape.lineTo(localPoints[i].x, localPoints[i].y);
        }
        shape.closePath();
        
        // Создаём новую геометрию
        const extrudeSettings = { depth: height, bevelEnabled: false };
        const newGeometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        
        // Заменяем геометрию
        mesh.geometry.dispose();
        mesh.geometry = newGeometry;
        
        console.log('[GridEditMode] Геометрия пересоздана, вершин:', localPoints.length);
    }
    
    _updateMeshGeometryFromCustomGrid() {
        // Извлекаем точки из customGrid и обновляем геометрию
        const customGrid = this.activeMesh.userData.customGrid;
        if (!customGrid || !customGrid.facades) return;
        
        const localPoints = [];
        for (const facade of customGrid.facades) {
            if (facade && facade.start) {
                localPoints.push({ x: facade.start.x, y: facade.start.y });
            }
        }
        
        if (localPoints.length >= 3) {
            this._rebuildMeshGeometry(localPoints);
        }
    }
    
    // ==================== Mouse Handlers ====================
    
    _handleMouseDown(event) {
        if (!this.enabled || event.button !== 0) return;
        
        // Обновляем видимые фасады перед любым действием
        this._updateVisibleFaces();
        
        const rect = this.renderer.domElement.getBoundingClientRect();
        const screenX = event.clientX - rect.left;
        const screenY = event.clientY - rect.top;
        
        // Режим ячеек
        if (this.editMode === 'cells') {
            const cell = this._findNearestCell(screenX, screenY);
            if (cell) {
                this._selectCell(cell, event.shiftKey, event.ctrlKey, event.altKey);
            }
            this._updatePanel();
            return;
        }
        
        // Shift+клик — добавить вертикальную линию
        if (event.shiftKey) {
            const fi = this._findNearestFace(screenX, screenY);
            console.log('[GridEditMode] Shift+click, face:', fi);
            if (fi >= 0) {
                const { t } = this._unprojectToFace(screenX, screenY, fi);
                this._addVerticalLine(fi, t);
            }
            return;
        }
        
        // Ctrl+клик — добавить горизонтальную линию
        if (event.ctrlKey) {
            const fi = this._findNearestFace(screenX, screenY);
            console.log('[GridEditMode] Ctrl+click, face:', fi);
            if (fi >= 0) {
                const { z } = this._unprojectToFace(screenX, screenY, fi);
                this._addHorizontalLine(z);
            }
            return;
        }
        
        // Обычный клик — выбор/drag
        const edge = this._findNearestEdge(screenX, screenY);
        
        if (edge) {
            const fi = edge.type === 'corner' ? edge.vertexIndex : edge.facadeIndex;
            const isVisible = this.visibleFaces.has(fi);
            console.log('[GridEditMode] Click edge:', edge.type, 
                edge.type === 'corner' ? `vertex:${edge.vertexIndex}` : `line:${edge.lineIndex}`,
                `facade:${fi}`, isVisible ? '(visible)' : '(HIDDEN - BUG!)');
            
            // Сбрасываем предыдущее выделение если это другой edge
            if (this.selectedEdge && !this._isSameEdge(this.selectedEdge, edge)) {
                this._restoreEdge(this.selectedEdge);
            }
            
            // Сбрасываем hover
            if (this.hoveredEdge && !this._isSameEdge(this.hoveredEdge, edge)) {
                this._restoreEdge(this.hoveredEdge);
                this.hoveredEdge = null;
            }
            
            // Всегда начинаем drag независимо от того, был ли edge уже выбран
            this.selectedEdge = edge;
            this.isDragging = true;
            this.dragData = edge;
            this.dragStart = { x: screenX, y: screenY };
            this.dragAccum = { x: 0, y: 0 };  // Сброс для corner
            this.activeFace = null;
            
            // Принудительно очищаем и пересоздаём подсветку
            this._clearHighlight();
            this._highlightEdge(edge, this.materials.drag);
            this.renderer.domElement.style.cursor = 'grabbing';
        } else {
            if (this.selectedEdge) {
                this._restoreEdge(this.selectedEdge);
                this.selectedEdge = null;
            }
            if (this.hoveredEdge) {
                this._restoreEdge(this.hoveredEdge);
                this.hoveredEdge = null;
            }
        }
        
        this._updatePanel();
    }
    
    _handleMouseMove(event) {
        if (!this.enabled) return;
        
        const rect = this.renderer.domElement.getBoundingClientRect();
        const screenX = event.clientX - rect.left;
        const screenY = event.clientY - rect.top;
        
        // Обновляем видимые фасады (на случай если камера изменилась)
        this._updateVisibleFaces();
        
        if (this.isDragging && this.dragData && this.dragStart) {
            const deltaX = screenX - this.dragStart.x;
            const deltaY = screenY - this.dragStart.y;
            
            this._applyDrag(deltaX, deltaY);
            this.dragStart = { x: screenX, y: screenY };
            this._updatePanel();
            return;
        }
        
        // Hover
        if (this.editMode === 'edges') {
            // Курсор для горячих клавиш
            if (event.shiftKey || event.ctrlKey) {
                this.renderer.domElement.style.cursor = 'cell';
                return;
            }
            
            const edge = this._findNearestEdge(screenX, screenY);
            
            if (edge && !this._isSameEdge(edge, this.hoveredEdge) && !this._isSameEdge(edge, this.selectedEdge)) {
                if (this.hoveredEdge && !this._isSameEdge(this.hoveredEdge, this.selectedEdge)) {
                    this._restoreEdge(this.hoveredEdge);
                }
                this._highlightEdge(edge, this.materials.hover);
                this.hoveredEdge = edge;
                
                // Правильный курсор для типа ребра
                if (edge.type === 'horizontal') {
                    this.renderer.domElement.style.cursor = 'ns-resize';
                } else if (edge.type === 'vertical') {
                    this.renderer.domElement.style.cursor = 'ew-resize';
                } else if (edge.type === 'corner') {
                    this.renderer.domElement.style.cursor = 'move';
                }
                
            } else if (!edge && this.hoveredEdge) {
                if (!this._isSameEdge(this.hoveredEdge, this.selectedEdge)) {
                    this._restoreEdge(this.hoveredEdge);
                }
                this.hoveredEdge = null;
                this.renderer.domElement.style.cursor = 'default';
            }
        } else {
            const cell = this._findNearestCell(screenX, screenY);
            this.renderer.domElement.style.cursor = cell ? 'pointer' : 'default';
        }
    }
    
    _handleMouseUp(event) {
        if (!this.isDragging) return;
        
        if (this.dragData && this.selectedEdge === this.dragData) {
            this._highlightEdge(this.selectedEdge, this.materials.selected);
        }
        
        this.renderer.domElement.style.cursor = 'default';
        this.isDragging = false;
        this.dragData = null;
        this.dragStart = null;
        this.hoveredEdge = null;
        
        this._updatePanel();
    }
    
    _handleKeyDown(event) {
        if (!this.enabled) return;
        
        if (event.key === 'Delete' || event.key === 'Backspace') {
            if (this.editMode === 'edges' && this.selectedEdge) {
                event.preventDefault();
                event.stopImmediatePropagation();  // Полностью останавливаем событие!
                this._deleteSelectedEdge();
                return;
            }
        }
        
        if (event.key === 'Escape') {
            event.stopImmediatePropagation();
            if (this.selectedEdge) {
                this._restoreEdge(this.selectedEdge);
                this.selectedEdge = null;
            }
            this.selectedCells.clear();
            this._updatePanel();
        }
    }
    
    // ==================== Выбор ячеек ====================
    
    _selectCell(cell, shift, ctrl, alt) {
        if (shift) {
            if (this.selectedCells.has(cell.key)) this.selectedCells.delete(cell.key);
            else this.selectedCells.add(cell.key);
        } else if (ctrl) {
            for (const c of this.cells) {
                if (c.facadeIndex === cell.facadeIndex && c.row === cell.row) {
                    this.selectedCells.add(c.key);
                }
            }
        } else if (alt) {
            for (const c of this.cells) {
                if (c.facadeIndex === cell.facadeIndex && c.col === cell.col) {
                    this.selectedCells.add(c.key);
                }
            }
        } else {
            this.selectedCells.clear();
            this.selectedCells.add(cell.key);
        }
    }
    
    // ==================== Drag ====================
    
    _getAdjacentFaces(vertexIndex) {
        const customGrid = this.activeMesh.userData.customGrid;
        const n = customGrid.facades.length;
        const leftFaceIndex = (vertexIndex - 1 + n) % n;
        const rightFaceIndex = vertexIndex;
        
        const leftFacade = customGrid.facades[leftFaceIndex];
        const rightFacade = customGrid.facades[rightFaceIndex];
        
        let leftDir = { x: 0, y: 0 };
        let rightDir = { x: 0, y: 0 };
        
        if (leftFacade) {
            const dx = leftFacade.end.x - leftFacade.start.x;
            const dy = leftFacade.end.y - leftFacade.start.y;
            const len = Math.hypot(dx, dy);
            if (len > 0) leftDir = { x: dx / len, y: dy / len };
        }
        
        if (rightFacade) {
            const dx = rightFacade.end.x - rightFacade.start.x;
            const dy = rightFacade.end.y - rightFacade.start.y;
            const len = Math.hypot(dx, dy);
            if (len > 0) rightDir = { x: dx / len, y: dy / len };
        }
        
        return {
            left: { index: leftFaceIndex, dir: leftDir },
            right: { index: rightFaceIndex, dir: rightDir }
        };
    }
    
    _projectScreenDeltaToFace(deltaScreen, faceDir) {
        const rot = this.activeMesh.rotation.z || 0;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        
        // Преобразуем направление фасада в мировые координаты
        const worldDirX = faceDir.x * cos - faceDir.y * sin;
        const worldDirY = faceDir.x * sin + faceDir.y * cos;
        
        // Проецируем на экран
        const screenRef = this._project3DToScreen({ x: 0, y: 0, z: 5 });
        const screenMoved = this._project3DToScreen({ x: worldDirX, y: worldDirY, z: 5 });
        
        const screenDirX = screenMoved.x - screenRef.x;
        const screenDirY = screenMoved.y - screenRef.y;
        const len = Math.hypot(screenDirX, screenDirY);
        
        if (len < 0.01) return 0;
        return (deltaScreen.x * screenDirX + deltaScreen.y * screenDirY) / len;
    }
    
    _applyDrag(deltaX, deltaY) {
        const edge = this.dragData;
        const customGrid = this.activeMesh.userData.customGrid;
        
        const minGap = 0.5;
        
        if (edge.type === 'corner') {
            // Накапливаем смещение для определения направления
            this.dragAccum.x += deltaX;
            this.dragAccum.y += deltaY;
            
            // Определяем активный фасад после накопления достаточного движения
            if (!this.activeFace && Math.hypot(this.dragAccum.x, this.dragAccum.y) > 5) {
                const adj = this._getAdjacentFaces(edge.vertexIndex);
                const leftProj = Math.abs(this._projectScreenDeltaToFace(this.dragAccum, adj.left.dir));
                const rightProj = Math.abs(this._projectScreenDeltaToFace(this.dragAccum, adj.right.dir));
                this.activeFace = leftProj > rightProj ? 'left' : 'right';
                console.log('[GridEditMode] Corner drag: activeFace =', this.activeFace);
                
                // Подсвечиваем направление движения
                this._highlightCornerDirection(edge.vertexIndex, this.activeFace);
            }
            
            if (this.activeFace) {
                const adj = this._getAdjacentFaces(edge.vertexIndex);
                const faceInfo = this.activeFace === 'left' ? adj.left : adj.right;
                const proj = this._projectScreenDeltaToFace({ x: deltaX, y: deltaY }, faceInfo.dir);
                
                // Движение вдоль направления фасада
                const movement = proj * 0.05;
                
                const vi = edge.vertexIndex;
                const n = customGrid.facades.length;
                const facade = customGrid.facades[vi];
                const prevFacade = customGrid.facades[(vi - 1 + n) % n];
                
                if (facade && prevFacade) {
                    // Двигаем вершину (start текущего = end предыдущего)
                    facade.start.x += faceInfo.dir.x * movement;
                    facade.start.y += faceInfo.dir.y * movement;
                    prevFacade.end.x = facade.start.x;
                    prevFacade.end.y = facade.start.y;
                    
                    // Пересчитываем edgeLength
                    const oldPrevLength = prevFacade.edgeLength;
                    const oldFacadeLength = facade.edgeLength;
                    
                    prevFacade.edgeLength = Math.hypot(
                        prevFacade.end.x - prevFacade.start.x,
                        prevFacade.end.y - prevFacade.start.y
                    );
                    facade.edgeLength = Math.hypot(
                        facade.end.x - facade.start.x,
                        facade.end.y - facade.start.y
                    );
                    
                    // Масштабируем вертикальные линии ПРОПОРЦИОНАЛЬНО (не пересоздаём!)
                    this._scaleVerticalLines(prevFacade, oldPrevLength);
                    this._scaleVerticalLines(facade, oldFacadeLength);
                    
                    // Обновляем геометрию mesh
                    this._updateMeshGeometryFromCustomGrid();
                    
                    // Перестраиваем сетку и edges
                    this._rebuild();
                }
            }
            
        } else if (edge.type === 'vertical') {
            const facade = customGrid.facades[edge.facadeIndex];
            if (!facade) return;
            
            const facadeDir = edge.facadeDir;
            
            // Вычисляем масштаб: сколько пикселей = 1 метр вдоль фасада
            const p1Screen = this._project3DToScreen(edge.p1);
            const p1Moved = this._project3DToScreen({
                x: edge.p1.x + facadeDir.x,
                y: edge.p1.y + facadeDir.y,
                z: edge.p1.z
            });
            
            const screenDirX = p1Moved.x - p1Screen.x;
            const screenDirY = p1Moved.y - p1Screen.y;
            const pixelsPerMeter = Math.hypot(screenDirX, screenDirY);
            
            if (pixelsPerMeter > 0.01) {
                // Нормализуем направление на экране
                const screenDirNormX = screenDirX / pixelsPerMeter;
                const screenDirNormY = screenDirY / pixelsPerMeter;
                
                // Проекция движения мыши на направление фасада (в пикселях)
                const projPixels = deltaX * screenDirNormX + deltaY * screenDirNormY;
                
                // Переводим в метры
                const deltaMeters = projPixels / pixelsPerMeter;
                
                const vi = edge.lineIndex;
                const { verticalLines, edgeLength } = facade;
                const oldPos = verticalLines[vi];
                const prev = verticalLines[vi - 1] ?? 0;
                const next = verticalLines[vi + 1] ?? edgeLength;
                
                let newPos = oldPos + deltaMeters;
                newPos = Math.max(prev + minGap, Math.min(next - minGap, newPos));
                verticalLines[vi] = newPos;
            }
            
        } else if (edge.type === 'horizontal') {
            const facade = customGrid.facades[edge.facadeIndex];
            if (!facade) return;
            
            const hi = edge.lineIndex;
            const { horizontalLines } = facade;
            const oldZ = horizontalLines[hi];
            const prev = horizontalLines[hi - 1] ?? 0;
            const next = horizontalLines[hi + 1] ?? edge.maxZ;
            const deltaZ = -deltaY / 8;
            
            let newZ = oldZ + deltaZ;
            newZ = Math.max(prev + minGap, Math.min(next - minGap, newZ));
            
            for (const f of customGrid.facades) {
                if (f && f.horizontalLines[hi] !== undefined) {
                    f.horizontalLines[hi] = newZ;
                }
            }
        }
        
        this._rebuild();
    }
    
    _rebuild() {
        // Сохраняем данные о текущем edge (из dragData или selectedEdge)
        const currentEdge = this.dragData ?? this.selectedEdge;
        const savedType = currentEdge?.type;
        const savedFacade = currentEdge?.facadeIndex;
        const savedLine = currentEdge?.lineIndex;
        const savedVertex = currentEdge?.vertexIndex;
        
        this.grid.createGridWithCustomLayout(this.activeMesh);
        this.grid.setPointsVisible(false);
        
        this._updateVisibleFaces();
        this._buildEdges();
        this._buildCells();
        
        if (savedType !== undefined) {
            let newEdge = null;
            
            if (savedType === 'corner') {
                newEdge = this.edges.find(e => e.type === 'corner' && e.vertexIndex === savedVertex);
            } else {
                newEdge = this.edges.find(e => 
                    e.type === savedType && e.facadeIndex === savedFacade && e.lineIndex === savedLine
                );
            }
            
            if (newEdge) {
                if (this.isDragging && this.dragData) {
                    this.dragData = newEdge;
                    this._highlightEdge(newEdge, this.materials.drag);
                }
                if (this.selectedEdge) {
                    this.selectedEdge = newEdge;
                }
            } else {
                // Edge не найден — сбрасываем
                this.selectedEdge = null;
                if (this.isDragging) {
                    this.dragData = null;
                }
            }
        }
        
        // Сбрасываем hovered, так как edges пересозданы
        this.hoveredEdge = null;
        
        this._updatePanel();
    }
    
    // ==================== Panel ====================
    
    _createPanel() {
        if (this.panel) return;
        
        this.panel = document.createElement('div');
        this.panel.id = 'grid-edit-panel';
        this.panel.innerHTML = `
            <div class="gep-header">
                <span class="gep-title">Редактирование сетки</span>
                <span class="gep-drag">⋮⋮</span>
            </div>
            <div class="gep-content">
                <div class="gep-mode" id="gep-mode">Режим: рёбра</div>
                <div class="gep-buttons">
                    <button id="gep-edges" class="active">Рёбра</button>
                    <button id="gep-cells">Ячейки</button>
                </div>
                <div class="gep-info" id="gep-info-edges">
                    <div><kbd>Клик</kbd> выбрать / <kbd>Drag</kbd> двигать</div>
                    <div><kbd>Del</kbd> удалить выбранное</div>
                    <div><kbd>Shift</kbd>+клик — верт. линия</div>
                    <div><kbd>Ctrl</kbd>+клик — гориз. линия</div>
                </div>
                <div class="gep-info" id="gep-info-cells" style="display:none">
                    <div><kbd>Клик</kbd> выбрать ячейку</div>
                    <div><kbd>Shift</kbd> +/- выделение</div>
                    <div><kbd>Ctrl</kbd> ряд / <kbd>Alt</kbd> столбец</div>
                </div>
                <div class="gep-stats" id="gep-stats"></div>
            </div>
        `;
        
        const style = document.createElement('style');
        style.id = 'gep-styles';
        style.textContent = `
            #grid-edit-panel {
                position: fixed; top: 100px; right: 20px; width: 200px;
                background: #16213e; border-radius: 8px; color: #eee;
                font: 12px -apple-system, sans-serif; z-index: 10000; user-select: none;
                box-shadow: 0 4px 20px rgba(0,0,0,0.4);
            }
            .gep-header {
                display: flex; justify-content: space-between; padding: 10px 12px;
                background: #0f3460; border-radius: 8px 8px 0 0; cursor: move;
            }
            .gep-title { font-weight: 600; }
            .gep-drag { color: #7f8c8d; }
            .gep-content { padding: 12px; }
            .gep-mode {
                padding: 8px; background: #e94560; border-radius: 4px;
                text-align: center; margin-bottom: 10px; font-weight: 500;
            }
            .gep-mode.editing { background: #00aa55; }
            .gep-mode.dragging { background: #ff9500; }
            .gep-mode.cells { background: #0088ff; }
            .gep-buttons { display: flex; gap: 6px; margin-bottom: 10px; }
            .gep-buttons button {
                flex: 1; padding: 6px; border: none; border-radius: 4px;
                background: #0f3460; color: #eee; cursor: pointer; font-size: 11px;
            }
            .gep-buttons button:hover { background: #1a5490; }
            .gep-buttons button.active { background: #00aa55; }
            .gep-info { background: #0f3460; border-radius: 4px; padding: 8px; margin-bottom: 8px; }
            .gep-info div { margin: 3px 0; color: #bbb; font-size: 11px; }
            .gep-info kbd {
                background: #1a5490; padding: 1px 4px; border-radius: 3px;
                font-family: monospace; font-size: 10px;
            }
            .gep-stats { font: 10px monospace; color: #7f8c8d; line-height: 1.4; }
        `;
        document.head.appendChild(style);
        document.body.appendChild(this.panel);
        
        this._makePanelDraggable();
        
        document.getElementById('gep-edges').onclick = () => this._setMode('edges');
        document.getElementById('gep-cells').onclick = () => this._setMode('cells');
        
        this._updatePanel();
    }
    
    _removePanel() {
        if (this.panel) { this.panel.remove(); this.panel = null; }
        document.getElementById('gep-styles')?.remove();
    }
    
    _makePanelDraggable() {
        const header = this.panel.querySelector('.gep-header');
        let dragging = false, startX, startY, startLeft, startTop;
        
        header.onmousedown = (e) => {
            dragging = true;
            startX = e.clientX; startY = e.clientY;
            const rect = this.panel.getBoundingClientRect();
            startLeft = rect.left; startTop = rect.top;
            e.preventDefault();
        };
        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            this.panel.style.left = (startLeft + e.clientX - startX) + 'px';
            this.panel.style.top = (startTop + e.clientY - startY) + 'px';
            this.panel.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => { dragging = false; });
    }
    
    _setMode(mode) {
        this.editMode = mode;
        this.selectedEdge = null;
        this.selectedCells.clear();
        this._restoreAllMaterials();
        
        document.getElementById('gep-edges').classList.toggle('active', mode === 'edges');
        document.getElementById('gep-cells').classList.toggle('active', mode === 'cells');
        document.getElementById('gep-info-edges').style.display = mode === 'edges' ? 'block' : 'none';
        document.getElementById('gep-info-cells').style.display = mode === 'cells' ? 'block' : 'none';
        
        this._updatePanel();
    }
    
    _updatePanel() {
        if (!this.panel) return;
        
        const modeEl = document.getElementById('gep-mode');
        const statsEl = document.getElementById('gep-stats');
        
        if (this.editMode === 'cells') {
            modeEl.textContent = `Ячейки (${this.selectedCells.size})`;
            modeEl.className = 'gep-mode cells';
        } else if (this.isDragging) {
            modeEl.textContent = 'Перемещение...';
            modeEl.className = 'gep-mode dragging';
        } else if (this.selectedEdge) {
            const t = this.selectedEdge.type;
            let text = '';
            if (t === 'corner') {
                text = `Угол #${this.selectedEdge.vertexIndex + 1}`;
            } else if (t === 'horizontal') {
                text = `z=${this.selectedEdge.z.toFixed(1)}м`;
            } else {
                text = `Верт. ${this.selectedEdge.lineIndex}`;
            }
            modeEl.textContent = text;
            modeEl.className = 'gep-mode editing';
        } else {
            modeEl.textContent = 'Режим: рёбра';
            modeEl.className = 'gep-mode';
        }
        
        const totalFacades = this.activeMesh?.userData.customGrid?.facades.filter(f => f).length || 0;
        const cornerCount = this.edges.filter(e => e.type === 'corner').length;
        statsEl.textContent = `Фасадов: ${this.visibleFaces.size}/${totalFacades}\nРёбер: ${this.edges.length} (углов: ${cornerCount})\nЯчеек: ${this.cells.length}`;
    }
}

export { GridEditMode };