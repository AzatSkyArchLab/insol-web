/**
 * ============================================
 * InsolationGrid.js
 * Инсоляционная сетка на фасадах здания
 * Поддержка множественного выбора зданий
 * Синхронное перемещение с зданием
 * Кастомная разбивка сетки
 * ============================================
 */

class InsolationGrid {
    constructor(sceneManager, options = {}) {
        this.sceneManager = sceneManager;
        this.scene = sceneManager.scene;
        this.camera = sceneManager.camera;
        this.renderer = sceneManager.renderer;
        
        // Параметры сетки
        this.verticalStep = options.verticalStep || 3.0;
        this.horizontalStep = options.horizontalStep || 3.0;
        this.horizontalMaxStep = options.horizontalMaxStep || 3.3;
        this.minCellHeight = options.minCellHeight || 2.5;  // Минимальная высота ячейки для точек
        this.offset = options.offset || 0.01;
        this.pointSize = options.pointSize || 0.5;
        
        // Визуальные элементы
        this.pointsGroup = null;
        this.gridLinesGroup = null;
        
        // Группы для каждого здания
        this.meshGroups = new Map();
        
        // Поддержка множественного выбора
        this.activeMeshes = [];
        
        // Данные точек
        this.calculationPoints = [];
        this.selectedPoints = new Set();
        
        // Материалы
        this.pointMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
        this.gridLineMaterial = new THREE.LineBasicMaterial({ 
            color: 0x222222,  // Почти чёрный для лучшей видимости
            transparent: false
        });
        
        // Материал для corner линий (вершины полигона) - оранжевый цилиндр
        this.cornerLineMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xff6600,  // Оранжевый
            transparent: true,
            opacity: 0.8
        });
        
        // Raycaster для выбора точек
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        // Callbacks
        this.onPointSelect = options.onPointSelect || (() => {});
        this.onPointDeselect = options.onPointDeselect || (() => {});
        
        // Event handlers
        this._boundOnClick = this._onClick.bind(this);
        this._enabled = false;
        
        console.log('[InsolationGrid] Создан');
    }
    
    /**
     * Создать сетку для здания или нескольких зданий
     */
    createGrid(meshOrMeshes) {
        this.clearGrid();
        
        const meshes = Array.isArray(meshOrMeshes) ? meshOrMeshes : [meshOrMeshes];
        
        if (meshes.length === 0) {
            console.warn('[InsolationGrid] Нет зданий для создания сетки');
            return null;
        }
        
        this.activeMeshes = meshes;
        
        this.pointsGroup = new THREE.Group();
        this.pointsGroup.name = 'insolation-points';
        
        this.gridLinesGroup = new THREE.Group();
        this.gridLinesGroup.name = 'insolation-grid';
        
        this.calculationPoints = [];
        
        for (let meshIndex = 0; meshIndex < meshes.length; meshIndex++) {
            const mesh = meshes[meshIndex];
            
            // Если есть кастомная разбивка — используем её
            if (mesh.userData.customGrid) {
                this._createGridFromCustomLayout(mesh, meshIndex);
            } else {
                this._createGridForMesh(mesh, meshIndex);
            }
        }
        
        this.scene.add(this.pointsGroup);
        this.scene.add(this.gridLinesGroup);
        
        this._enableSelection();
        
        console.log(`[InsolationGrid] Создано ${this.calculationPoints.length} точек для ${meshes.length} зданий`);
        
        return this.calculationPoints;
    }
    
    /**
     * Создать сетку для одного здания
     */
    _createGridForMesh(mesh, meshIndex) {
        // Получаем локальные точки контура (без учёта position и rotation)
        const localPoints = this._extractLocalBasePoints(mesh);
        if (!localPoints || localPoints.length < 3) {
            console.warn(`[InsolationGrid] Не удалось извлечь точки здания ${mesh.userData.id}`);
            return;
        }
        
        const height = mesh.userData.properties?.height || 9;
        const levels = Math.floor(height / this.verticalStep);
        
        console.log(`[InsolationGrid] Здание ${meshIndex + 1}: ${mesh.userData.id}, высота: ${height}м`);
        
        // Вычисляем signed area для определения направления обхода
        let signedArea = 0;
        for (let i = 0; i < localPoints.length; i++) {
            const j = (i + 1) % localPoints.length;
            signedArea += localPoints[i].x * localPoints[j].y;
            signedArea -= localPoints[j].x * localPoints[i].y;
        }
        signedArea /= 2;
        
        // Если CCW (signedArea > 0), нужно инвертировать нормали
        const needFlipNormals = signedArea > 0;
        
        // Вычисляем центр масс полигона (для совместимости)
        const centerX = localPoints.reduce((s, v) => s + v.x, 0) / localPoints.length;
        const centerY = localPoints.reduce((s, v) => s + v.y, 0) / localPoints.length;
        
        // Создаём группу для этого здания
        const meshGroup = {
            pointIndices: [],
            lineObjects: [],
            localPointData: [],  // {localX, localY, localZ, localNormalX, localNormalY}
            localLineData: [],   // [{x, y, z}, {x, y, z}]
            height: height
        };
        
        // Создаём customGrid для совместимости с CellFeaturesManager
        const facades = [];
        
        // Для каждого ребра (фасада)
        for (let i = 0; i < localPoints.length; i++) {
            const p1 = localPoints[i];
            const p2 = localPoints[(i + 1) % localPoints.length];
            
            // Вычисляем параметры фасада для customGrid
            const edgeVec = new THREE.Vector2(p2.x - p1.x, p2.y - p1.y);
            const edgeLength = edgeVec.length();
            
            if (edgeLength >= 1) {
                // Количество сегментов
                let horizontalSegments = Math.max(1, Math.round(edgeLength / this.horizontalStep));
                let actualStep = edgeLength / horizontalSegments;
                
                if (actualStep > this.horizontalMaxStep) {
                    horizontalSegments = Math.ceil(edgeLength / this.horizontalMaxStep);
                }
                
                // Вертикальные линии (позиции вдоль ребра)
                const verticalLines = [];
                for (let h = 0; h <= horizontalSegments; h++) {
                    const t = h / horizontalSegments;
                    verticalLines.push(t * edgeLength);
                }
                
                // Горизонтальные линии (высоты)
                const horizontalLines = [];
                for (let v = 0; v <= levels; v++) {
                    const z = v * this.verticalStep;
                    if (z <= height) horizontalLines.push(z);
                }
                if (horizontalLines[horizontalLines.length - 1] < height) {
                    horizontalLines.push(height);
                }
                
                facades.push({
                    start: { x: p1.x, y: p1.y },
                    end: { x: p2.x, y: p2.y },
                    edgeLength,
                    verticalLines,
                    horizontalLines
                });
            } else {
                facades.push(null);
            }
            
            this._createFacadeGrid(p1, p2, height, levels, i, mesh, meshIndex, meshGroup, centerX, centerY, needFlipNormals);
        }
        
        // Сохраняем customGrid для использования CellFeaturesManager
        mesh.userData.customGrid = { facades };
        console.log(`[InsolationGrid] Created customGrid with ${facades.filter(f => f).length} facades`);
        if (facades.length > 0 && facades[0]) {
            console.log('[InsolationGrid] Sample facade:', 
                'verticalLines:', facades[0].verticalLines?.length,
                'horizontalLines:', facades[0].horizontalLines?.length,
                'edgeLength:', facades[0].edgeLength?.toFixed(2));
        }
        
        this.meshGroups.set(mesh, meshGroup);
        
        // Синхронизируем с текущей позицией здания
        this.syncWithMesh(mesh);
    }
    
    /**
     * Создать сетку для одного фасада (в локальных координатах)
     */
    _createFacadeGrid(p1, p2, height, levels, facadeIndex, mesh, meshIndex, meshGroup, centerX, centerY, needFlipNormals = false) {
        const edgeVec = new THREE.Vector2(p2.x - p1.x, p2.y - p1.y);
        const edgeLength = edgeVec.length();
        
        if (edgeLength < 1) return;
        
        const edgeDir = edgeVec.clone().normalize();
        
        // Нормаль - перпендикуляр к направлению фасада
        // Поворот на 90° против часовой: (x, y) -> (-y, x)
        let normalX = -edgeDir.y;
        let normalY = edgeDir.x;
        
        // Инвертируем если полигон по часовой стрелке
        if (needFlipNormals) {
            normalX = -normalX;
            normalY = -normalY;
        }
        
        // Количество сегментов
        let horizontalSegments = Math.max(1, Math.round(edgeLength / this.horizontalStep));
        let actualStep = edgeLength / horizontalSegments;
        
        if (actualStep > this.horizontalMaxStep) {
            horizontalSegments = Math.ceil(edgeLength / this.horizontalMaxStep);
        }
        
        // Вертикальные линии
        for (let h = 0; h <= horizontalSegments; h++) {
            const t = h / horizontalSegments;
            const localX = p1.x + (p2.x - p1.x) * t;
            const localY = p1.y + (p2.y - p1.y) * t;
            
            // Создаём линию (позиция будет обновлена в syncWithMesh)
            const linePoints = [
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(0, 0, height)
            ];
            
            const geometry = new THREE.BufferGeometry().setFromPoints(linePoints);
            const line = new THREE.Line(geometry, this.gridLineMaterial.clone());
            this.gridLinesGroup.add(line);
            meshGroup.lineObjects.push(line);
            
            // Сохраняем локальные координаты
            meshGroup.localLineData.push([
                { x: localX, y: localY, z: 0 },
                { x: localX, y: localY, z: height }
            ]);
        }
        
        // Горизонтальные линии (строго каждые 3м + верхняя граница)
        const horizontalZs = [];
        for (let v = 0; v <= levels; v++) {
            const z = v * this.verticalStep;
            if (z <= height) horizontalZs.push(z);
        }
        // Добавляем верхнюю границу если её ещё нет
        if (horizontalZs[horizontalZs.length - 1] < height) {
            horizontalZs.push(height);
        }
        
        // Диагностика (только для первого фасада)
        if (facadeIndex === 0) {
            console.log(`[InsolationGrid] Фасад 0: height=${height}, horizontalZs=[${horizontalZs.join(', ')}]`);
        }
        
        for (const z of horizontalZs) {
            const linePoints = [
                new THREE.Vector3(0, 0, z),
                new THREE.Vector3(0, 0, z)
            ];
            
            const geometry = new THREE.BufferGeometry().setFromPoints(linePoints);
            const line = new THREE.Line(geometry, this.gridLineMaterial.clone());
            this.gridLinesGroup.add(line);
            meshGroup.lineObjects.push(line);
            
            meshGroup.localLineData.push([
                { x: p1.x, y: p1.y, z: z },
                { x: p2.x, y: p2.y, z: z }
            ]);
        }
        
        // Расчётные точки — в центрах ячеек между горизонтальными линиями
        // Только для ячеек высотой >= minCellHeight
        for (let v = 0; v < horizontalZs.length - 1; v++) {
            const cellHeight = horizontalZs[v + 1] - horizontalZs[v];
            if (cellHeight < this.minCellHeight) continue;  // Пропускаем низкие ячейки
            
            const z = (horizontalZs[v] + horizontalZs[v + 1]) / 2;
            
            for (let h = 0; h < horizontalSegments; h++) {
                const t = (h + 0.5) / horizontalSegments;
                
                const localX = p1.x + (p2.x - p1.x) * t + normalX * this.offset;
                const localY = p1.y + (p2.y - p1.y) * t + normalY * this.offset;
                
                // Создаём точку (позиция будет обновлена в syncWithMesh)
                const pointGeometry = new THREE.SphereGeometry(this.pointSize, 12, 12);
                const pointMesh = new THREE.Mesh(pointGeometry, this.pointMaterial.clone());
                
                const pointIndex = this.calculationPoints.length;
                pointMesh.userData = { 
                    type: 'insolation-point',
                    index: pointIndex 
                };
                this.pointsGroup.add(pointMesh);
                
                meshGroup.pointIndices.push(pointIndex);
                
                // Сохраняем локальные данные
                meshGroup.localPointData.push({
                    localX: localX,
                    localY: localY,
                    localZ: z,
                    localNormalX: normalX,
                    localNormalY: normalY
                });
                
                // Данные точки (position будет обновлён в syncWithMesh)
                this.calculationPoints.push({
                    index: pointIndex,
                    position: new THREE.Vector3(0, 0, z),
                    normal: new THREE.Vector3(normalX, normalY, 0),
                    facadeIndex: facadeIndex,
                    level: v,
                    horizontalIndex: h,
                    mesh: pointMesh,
                    selected: false,
                    result: null,
                    buildingMesh: mesh,
                    buildingIndex: meshIndex,
                    buildingId: mesh.userData.id
                });
            }
        }
    }
    
    /**
     * Извлечь локальные базовые точки здания (без position и rotation)
     */
    _extractLocalBasePoints(mesh) {
        // Из Shape geometry
        const params = mesh.geometry.parameters;
        if (params && params.shapes) {
            const shape = params.shapes;
            const shapePoints = shape.getPoints ? shape.getPoints() : null;
            
            if (shapePoints && shapePoints.length >= 3) {
                return shapePoints.map(p => ({ x: p.x, y: p.y }));
            }
        }
        
        // Из localBasePoints (если они сохранены)
        if (mesh.userData.localBasePoints && mesh.userData.localBasePoints.length >= 3) {
            return mesh.userData.localBasePoints.map(p => ({ x: p.x, y: p.y }));
        }
        
        // Из мировых basePoints — конвертируем в локальные
        if (mesh.userData.basePoints && mesh.userData.basePoints.length >= 3) {
            const pos = mesh.position;
            const rot = mesh.rotation.z || 0;
            const cos = Math.cos(-rot);
            const sin = Math.sin(-rot);
            
            return mesh.userData.basePoints.map(p => {
                // Убираем position
                const dx = p.x - pos.x;
                const dy = p.y - pos.y;
                // Убираем rotation (обратный поворот)
                return {
                    x: dx * cos - dy * sin,
                    y: dx * sin + dy * cos
                };
            });
        }
        
        // Из geometry attributes (уже в локальных координатах)
        const position = mesh.geometry.getAttribute('position');
        if (!position) return null;
        
        let minZ = Infinity;
        for (let i = 0; i < position.count; i++) {
            const z = position.getZ(i);
            if (z < minZ) minZ = z;
        }
        
        const pointsMap = new Map();
        for (let i = 0; i < position.count; i++) {
            const z = position.getZ(i);
            if (Math.abs(z - minZ) < 0.5) {
                const x = parseFloat(position.getX(i).toFixed(2));
                const y = parseFloat(position.getY(i).toFixed(2));
                const key = `${x},${y}`;
                
                if (!pointsMap.has(key)) {
                    pointsMap.set(key, { x, y });
                }
            }
        }
        
        let points = Array.from(pointsMap.values());
        if (points.length < 3) return null;
        
        // Сортируем по углу
        const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
        const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
        
        points.sort((a, b) => {
            return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx);
        });
        
        return points;
    }
    
    /**
     * Синхронизировать позиции сетки с текущим положением здания
     */
    syncWithMesh(mesh) {
        const meshGroup = this.meshGroups.get(mesh);
        if (!meshGroup) return;
        
        const pos = mesh.position;
        const rot = mesh.rotation.z || 0;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        
        // Обновляем точки
        for (let i = 0; i < meshGroup.pointIndices.length; i++) {
            const pointIndex = meshGroup.pointIndices[i];
            const point = this.calculationPoints[pointIndex];
            const local = meshGroup.localPointData[i];
            
            if (!point || !local) continue;
            
            // Поворачиваем локальные координаты и добавляем position
            const worldX = local.localX * cos - local.localY * sin + pos.x;
            const worldY = local.localX * sin + local.localY * cos + pos.y;
            
            point.position.x = worldX;
            point.position.y = worldY;
            point.position.z = local.localZ;
            point.mesh.position.set(worldX, worldY, local.localZ);
            
            // Поворачиваем нормаль
            point.normal.x = local.localNormalX * cos - local.localNormalY * sin;
            point.normal.y = local.localNormalX * sin + local.localNormalY * cos;
        }
        
        // Обновляем линии
        for (let i = 0; i < meshGroup.lineObjects.length; i++) {
            const line = meshGroup.lineObjects[i];
            const localPoints = meshGroup.localLineData[i];
            
            if (!localPoints) continue;
            
            // Corner цилиндры обрабатываем отдельно
            if (line.userData && line.userData.isCornerLine) {
                const lp0 = localPoints[0];
                const lp1 = localPoints[1];
                const midZ = (lp0.z + lp1.z) / 2;
                
                const worldX = lp0.x * cos - lp0.y * sin + pos.x;
                const worldY = lp0.x * sin + lp0.y * cos + pos.y;
                
                line.position.set(worldX, worldY, midZ);
                // Не нужно rotation.z так как цилиндр симметричен
                continue;
            }
            
            // Обычные линии
            const positions = line.geometry.attributes.position;
            
            for (let j = 0; j < positions.count && j < localPoints.length; j++) {
                const lp = localPoints[j];
                
                const worldX = lp.x * cos - lp.y * sin + pos.x;
                const worldY = lp.x * sin + lp.y * cos + pos.y;
                
                positions.setX(j, worldX);
                positions.setY(j, worldY);
                positions.setZ(j, lp.z);
            }
            
            positions.needsUpdate = true;
        }
    }
    
    /**
     * Обновить трансформацию сетки (вызывается из MoveTool)
     */
    updateMeshTransform(mesh) {
        this.syncWithMesh(mesh);
    }
    
    _enableSelection() {
        if (this._enabled) return;
        this._enabled = true;
        this.renderer.domElement.addEventListener('click', this._boundOnClick);
    }
    
    _disableSelection() {
        this._enabled = false;
        this.renderer.domElement.removeEventListener('click', this._boundOnClick);
    }
    
    _onClick(event) {
        if (!this.pointsGroup) return;
        
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        const intersects = this.raycaster.intersectObjects(this.pointsGroup.children, false);
        
        if (intersects.length > 0) {
            const pointMesh = intersects[0].object;
            const index = pointMesh.userData.index;
            
            if (index !== undefined) {
                this.togglePointSelection(index);
                event.stopPropagation();
            }
        }
    }
    
    togglePointSelection(index) {
        const point = this.calculationPoints[index];
        if (!point) return;
        
        if (point.selected) {
            point.selected = false;
            point.mesh.material.color.setHex(0xffffff);
            this.selectedPoints.delete(index);
            this.onPointDeselect(point);
        } else {
            point.selected = true;
            point.mesh.material.color.setHex(0x1a73e8);
            this.selectedPoints.add(index);
            this.onPointSelect(point);
        }
    }
    
    selectAll() {
        this.calculationPoints.forEach((point, index) => {
            if (!point.selected) {
                point.selected = true;
                point.mesh.material.color.setHex(0x1a73e8);
                this.selectedPoints.add(index);
            }
        });
    }
    
    deselectAll() {
        this.calculationPoints.forEach((point) => {
            if (point.selected) {
                point.selected = false;
                point.mesh.material.color.setHex(0xffffff);
            }
        });
        this.selectedPoints.clear();
    }
    
    getSelectedPoints() {
        return Array.from(this.selectedPoints).map(i => this.calculationPoints[i]);
    }
    
    setPointResult(index, result) {
        const point = this.calculationPoints[index];
        if (!point) return;
        
        point.result = result;
        
        let color;
        switch (result.status) {
            case 'PASS': color = 0x34a853; break;
            case 'WARNING': color = 0xfbbc04; break;
            case 'FAIL': color = 0xea4335; break;
            default: color = 0x888888;
        }
        
        point.mesh.material.color.setHex(color);
    }
    
    resetResults() {
        this.calculationPoints.forEach(point => {
            point.result = null;
            point.mesh.material.color.setHex(point.selected ? 0x1a73e8 : 0xffffff);
        });
    }
    
    clearGrid() {
        this._disableSelection();
        
        if (this.pointsGroup) {
            this.pointsGroup.children.forEach(child => {
                child.geometry.dispose();
                child.material.dispose();
            });
            this.scene.remove(this.pointsGroup);
            this.pointsGroup = null;
        }
        
        if (this.gridLinesGroup) {
            this.gridLinesGroup.children.forEach(child => {
                child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            this.scene.remove(this.gridLinesGroup);
            this.gridLinesGroup = null;
        }
        
        this.calculationPoints = [];
        this.selectedPoints.clear();
        this.activeMeshes = [];
        this.meshGroups.clear();
    }
    
    removeGridForMesh(mesh) {
        if (!mesh) return;
        
        const meshGroup = this.meshGroups.get(mesh);
        if (meshGroup) {
            // Удаляем линии сетки
            if (meshGroup.lineObjects) {
                for (const line of meshGroup.lineObjects) {
                    if (line.geometry) line.geometry.dispose();
                    if (line.material) line.material.dispose();
                    if (this.gridLinesGroup) this.gridLinesGroup.remove(line);
                }
            }
            
            // Удаляем точки из meshGroup
            if (meshGroup.pointObjects) {
                for (const point of meshGroup.pointObjects) {
                    if (point.geometry) point.geometry.dispose();
                    if (point.material) point.material.dispose();
                    if (this.pointsGroup) this.pointsGroup.remove(point);
                }
            }
            
            this.meshGroups.delete(mesh);
        }
        
        // Удаляем визуальные объекты точек расчёта и сами точки
        const pointsToRemove = this.calculationPoints.filter(p => p.buildingMesh === mesh);
        for (const point of pointsToRemove) {
            if (point.mesh) {
                if (point.mesh.geometry) point.mesh.geometry.dispose();
                if (point.mesh.material) point.mesh.material.dispose();
                if (this.pointsGroup) this.pointsGroup.remove(point.mesh);
            }
        }
        this.calculationPoints = this.calculationPoints.filter(p => p.buildingMesh !== mesh);
        
        // Удаляем из selectedPoints индексы удалённых точек
        this.selectedPoints.clear();
        
        // Удаляем из activeMeshes
        const idx = this.activeMeshes.indexOf(mesh);
        if (idx >= 0) {
            this.activeMeshes.splice(idx, 1);
        }
        
        // Удаляем customGrid
        if (mesh.userData) {
            delete mesh.userData.customGrid;
        }
        
        console.log('[InsolationGrid] Сетка и точки удалены для mesh');
    }
    
    setGridVisible(visible) {
        if (this.gridLinesGroup) {
            this.gridLinesGroup.visible = visible;
        }
    }
    
    setPointsVisible(visible) {
        if (this.pointsGroup) {
            this.pointsGroup.visible = visible;
        }
    }
    
    getCalculationPoints() {
        return this.calculationPoints;
    }
    
    getActiveMesh() {
        return this.activeMeshes.length > 0 ? this.activeMeshes[0] : null;
    }
    
    getActiveMeshes() {
        return this.activeMeshes;
    }
    
    isMeshActive(mesh) {
        return this.activeMeshes.includes(mesh);
    }
    
    getActiveMeshCount() {
        return this.activeMeshes.length;
    }
    
    hasGrid() {
        return this.calculationPoints.length > 0;
    }
    
    // ==================== Кастомная разбивка ====================
    
    /**
     * Создать сетку с кастомной разбивкой
     */
    createGridWithCustomLayout(meshOrMeshes) {
        this.clearGrid();
        
        const meshes = Array.isArray(meshOrMeshes) ? meshOrMeshes : [meshOrMeshes];
        
        if (meshes.length === 0) {
            console.warn('[InsolationGrid] Нет зданий для создания сетки');
            return null;
        }
        
        this.activeMeshes = meshes;
        
        this.pointsGroup = new THREE.Group();
        this.pointsGroup.name = 'insolation-points';
        
        this.gridLinesGroup = new THREE.Group();
        this.gridLinesGroup.name = 'insolation-grid';
        
        this.calculationPoints = [];
        
        for (let meshIndex = 0; meshIndex < meshes.length; meshIndex++) {
            const mesh = meshes[meshIndex];
            
            if (mesh.userData.customGrid) {
                this._createGridFromCustomLayout(mesh, meshIndex);
            } else {
                this._createGridForMesh(mesh, meshIndex);
            }
        }
        
        this.scene.add(this.pointsGroup);
        this.scene.add(this.gridLinesGroup);
        
        this._enableSelection();
        
        console.log(`[InsolationGrid] Создано ${this.calculationPoints.length} точек (custom layout)`);
        
        return this.calculationPoints;
    }
    
    /**
     * Создать сетку из кастомной разбивки
     */
    _createGridFromCustomLayout(mesh, meshIndex) {
        const customGrid = mesh.userData.customGrid;
        if (!customGrid || !customGrid.facades) return;
        
        const height = mesh.userData.properties?.height || 9;
        
        // Вычисляем центр масс полигона в локальных координатах
        const vertices = [];
        for (const facade of customGrid.facades) {
            if (facade) vertices.push({ x: facade.start.x, y: facade.start.y });
        }
        
        let centerX = 0, centerY = 0;
        if (vertices.length >= 3) {
            centerX = vertices.reduce((s, v) => s + v.x, 0) / vertices.length;
            centerY = vertices.reduce((s, v) => s + v.y, 0) / vertices.length;
        }
        
        const meshGroup = {
            pointIndices: [],
            lineObjects: [],
            localPointData: [],
            localLineData: [],
            height: height
        };
        
        for (let fi = 0; fi < customGrid.facades.length; fi++) {
            const facade = customGrid.facades[fi];
            if (!facade) continue;
            
            const { start, end, verticalLines, horizontalLines, edgeLength } = facade;
            
            // Направление ребра
            const dirX = (end.x - start.x) / edgeLength;
            const dirY = (end.y - start.y) / edgeLength;
            
            // Два варианта нормали
            let normalX = -dirY;
            let normalY = dirX;
            
            // Проверяем направлена ли нормаль наружу (от центра здания)
            const facadeMidX = (start.x + end.x) / 2;
            const facadeMidY = (start.y + end.y) / 2;
            const toCenterX = centerX - facadeMidX;
            const toCenterY = centerY - facadeMidY;
            
            // Если dot product > 0, нормаль направлена к центру - инвертируем
            const dot = normalX * toCenterX + normalY * toCenterY;
            if (dot > 0) {
                normalX = -normalX;
                normalY = -normalY;
            }
            
            // Вертикальные линии сетки
            for (let vi = 0; vi < verticalLines.length; vi++) {
                const t = verticalLines[vi];
                const localX = start.x + dirX * t;
                const localY = start.y + dirY * t;
                
                const facadeHeight = horizontalLines[horizontalLines.length - 1];
                
                // Первая линия каждого фасада - это corner (вершина полигона)
                const isCorner = (vi === 0);
                
                if (isCorner) {
                    // Создаём цилиндр для corner линии (более заметный)
                    const cylinderGeom = new THREE.CylinderGeometry(0.12, 0.12, facadeHeight, 8);
                    cylinderGeom.rotateX(-Math.PI / 2);  // Поворачиваем Y->Z для вертикальной линии
                    const cylinder = new THREE.Mesh(cylinderGeom, this.cornerLineMaterial.clone());
                    cylinder.userData.isCornerLine = true;
                    cylinder.userData.localPos = { x: localX, y: localY, z: facadeHeight / 2 };
                    this.gridLinesGroup.add(cylinder);
                    meshGroup.lineObjects.push(cylinder);
                    
                    meshGroup.localLineData.push([
                        { x: localX, y: localY, z: 0 },
                        { x: localX, y: localY, z: facadeHeight }
                    ]);
                } else {
                    // Обычная линия
                    const linePoints = [
                        new THREE.Vector3(0, 0, 0),
                        new THREE.Vector3(0, 0, facadeHeight)
                    ];
                    
                    const geometry = new THREE.BufferGeometry().setFromPoints(linePoints);
                    const line = new THREE.Line(geometry, this.gridLineMaterial.clone());
                    this.gridLinesGroup.add(line);
                    meshGroup.lineObjects.push(line);
                    
                    meshGroup.localLineData.push([
                        { x: localX, y: localY, z: 0 },
                        { x: localX, y: localY, z: facadeHeight }
                    ]);
                }
            }
            
            // Горизонтальные линии сетки
            for (let hi = 0; hi < horizontalLines.length; hi++) {
                const z = horizontalLines[hi];
                
                const linePoints = [
                    new THREE.Vector3(0, 0, z),
                    new THREE.Vector3(0, 0, z)
                ];
                
                const geometry = new THREE.BufferGeometry().setFromPoints(linePoints);
                const line = new THREE.Line(geometry, this.gridLineMaterial.clone());
                this.gridLinesGroup.add(line);
                meshGroup.lineObjects.push(line);
                
                meshGroup.localLineData.push([
                    { x: start.x, y: start.y, z: z },
                    { x: end.x, y: end.y, z: z }
                ]);
            }
            
            // Расчётные точки — в центрах ячеек
            // Только для ячеек высотой >= minCellHeight
            let pointsCreated = 0;
            
            // Получаем cellFeatures если есть
            const cellFeatures = mesh.userData.cellFeatures || {};
            
            for (let hi = 0; hi < horizontalLines.length - 1; hi++) {
                const cellHeight = horizontalLines[hi + 1] - horizontalLines[hi];
                if (cellHeight < this.minCellHeight) continue;  // Пропускаем низкие ячейки
                
                const z = (horizontalLines[hi] + horizontalLines[hi + 1]) / 2;
                
                for (let vi = 0; vi < verticalLines.length - 1; vi++) {
                    const t = (verticalLines[vi] + verticalLines[vi + 1]) / 2;
                    
                    // Проверяем есть ли окно в этой ячейке
                    const cellKey = `${fi}-${vi}-${hi}`;
                    const features = cellFeatures[cellKey];
                    
                    // Смещение точки от стены
                    let pointOffset = this.offset;  // стандартное смещение наружу
                    if (features && features.window) {
                        // Для окна точка на уровне стекла (стекло на уровне стены)
                        // Минимальное смещение наружу чтобы точка не была внутри стены
                        pointOffset = 0.02;  // 2 см от стены
                    }
                    
                    const localX = start.x + dirX * t + normalX * pointOffset;
                    const localY = start.y + dirY * t + normalY * pointOffset;
                    
                    const pointGeometry = new THREE.SphereGeometry(this.pointSize, 12, 12);
                    const pointMesh = new THREE.Mesh(pointGeometry, this.pointMaterial.clone());
                    
                    const pointIndex = this.calculationPoints.length;
                    pointMesh.userData = { 
                        type: 'insolation-point',
                        index: pointIndex,
                        hasWindow: !!(features && features.window)
                    };
                    this.pointsGroup.add(pointMesh);
                    
                    meshGroup.pointIndices.push(pointIndex);
                    
                    meshGroup.localPointData.push({
                        localX: localX,
                        localY: localY,
                        localZ: z,
                        localNormalX: normalX,
                        localNormalY: normalY
                    });
                    
                    this.calculationPoints.push({
                        index: pointIndex,
                        position: new THREE.Vector3(0, 0, z),
                        normal: new THREE.Vector3(normalX, normalY, 0),
                        facadeIndex: fi,
                        level: hi,
                        horizontalIndex: vi,
                        mesh: pointMesh,
                        selected: false,
                        result: null,
                        buildingMesh: mesh,
                        buildingIndex: meshIndex,
                        buildingId: mesh.userData.id,
                        hasWindow: !!(features && features.window),
                        cellKey: cellKey
                    });
                    
                    pointsCreated++;
                }
            }
            
            if (fi === 0) {
                console.log(`[InsolationGrid] Фасад 0: ${horizontalLines.length - 1} уровней, ${pointsCreated} точек`);
            }
        }
        
        this.meshGroups.set(mesh, meshGroup);
        this.syncWithMesh(mesh);
    }
}

export { InsolationGrid };
window.InsolationGrid = InsolationGrid;