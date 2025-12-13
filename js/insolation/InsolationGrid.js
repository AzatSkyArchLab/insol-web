/**
 * ============================================
 * InsolationGrid.js
 * Инсоляционная сетка на фасадах здания
 * Поддержка множественного выбора зданий
 * Синхронное перемещение с зданием
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
            color: 0x1a73e8, 
            transparent: true, 
            opacity: 0.4 
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
            this._createGridForMesh(mesh, meshIndex);
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
        
        // Создаём группу для этого здания
        const meshGroup = {
            pointIndices: [],
            lineObjects: [],
            localPointData: [],  // {localX, localY, localZ, localNormalX, localNormalY}
            localLineData: [],   // [{x, y, z}, {x, y, z}]
            height: height
        };
        
        // Для каждого ребра (фасада)
        for (let i = 0; i < localPoints.length; i++) {
            const p1 = localPoints[i];
            const p2 = localPoints[(i + 1) % localPoints.length];
            
            this._createFacadeGrid(p1, p2, height, levels, i, mesh, meshIndex, meshGroup);
        }
        
        this.meshGroups.set(mesh, meshGroup);
        
        // Синхронизируем с текущей позицией здания
        this.syncWithMesh(mesh);
    }
    
    /**
     * Создать сетку для одного фасада (в локальных координатах)
     */
    _createFacadeGrid(p1, p2, height, levels, facadeIndex, mesh, meshIndex, meshGroup) {
        const edgeVec = new THREE.Vector2(p2.x - p1.x, p2.y - p1.y);
        const edgeLength = edgeVec.length();
        
        if (edgeLength < 1) return;
        
        const edgeDir = edgeVec.clone().normalize();
        
        // Нормаль к фасаду (наружу) в локальных координатах
        const normalX = -edgeDir.y;
        const normalY = edgeDir.x;
        
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
        
        // Горизонтальные линии
        for (let v = 0; v <= levels; v++) {
            const z = v * this.verticalStep;
            if (z > height) break;
            
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
        
        // Расчётные точки
        for (let v = 0; v < levels; v++) {
            const z = (v + 0.5) * this.verticalStep;
            if (z > height) break;
            
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
}

export { InsolationGrid };
window.InsolationGrid = InsolationGrid;