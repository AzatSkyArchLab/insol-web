/**
 * ============================================
 * InsolationGrid.js
 * Инсоляционная сетка на фасадах здания
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
        this.pointSize = options.pointSize || 0.5; // Размер точки
        
        // Визуальные элементы
        this.pointsGroup = null;
        this.gridLinesGroup = null;
        this.activeMesh = null;
        
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
     * Создать сетку для здания
     */
    createGrid(mesh) {
        this.clearGrid();
        
        this.activeMesh = mesh;
        
        const points = this._extractBasePoints(mesh);
        if (!points || points.length < 3) {
            console.warn('[InsolationGrid] Не удалось извлечь точки здания');
            return null;
        }
        
        const height = mesh.userData.properties?.height || 9;
        const levels = Math.floor(height / this.verticalStep);
        
        console.log(`[InsolationGrid] Здание: ${mesh.userData.id}, высота: ${height}м, уровней: ${levels}`);
        
        this.pointsGroup = new THREE.Group();
        this.pointsGroup.name = 'insolation-points';
        
        this.gridLinesGroup = new THREE.Group();
        this.gridLinesGroup.name = 'insolation-grid';
        
        this.calculationPoints = [];
        
        // Для каждого ребра (фасада)
        for (let i = 0; i < points.length; i++) {
            const p1 = points[i];
            const p2 = points[(i + 1) % points.length];
            
            this._createFacadeGrid(p1, p2, height, levels, i);
        }
        
        this.scene.add(this.pointsGroup);
        this.scene.add(this.gridLinesGroup);
        
        // Включаем выбор точек
        this._enableSelection();
        
        console.log(`[InsolationGrid] Создано ${this.calculationPoints.length} расчётных точек`);
        
        return this.calculationPoints;
    }
    
    /**
     * Создать сетку для одного фасада
     */
    _createFacadeGrid(p1, p2, height, levels, facadeIndex) {
        const edgeVec = new THREE.Vector2(p2.x - p1.x, p2.y - p1.y);
        const edgeLength = edgeVec.length();
        
        if (edgeLength < 1) return;
        
        const edgeDir = edgeVec.clone().normalize();
        
        // Нормаль к фасаду (наружу)
        const normal = new THREE.Vector3(-edgeDir.y, edgeDir.x, 0);
        
        // Количество сегментов
        let horizontalSegments = Math.max(1, Math.round(edgeLength / this.horizontalStep));
        let actualStep = edgeLength / horizontalSegments;
        
        if (actualStep > this.horizontalMaxStep) {
            horizontalSegments = Math.ceil(edgeLength / this.horizontalMaxStep);
            actualStep = edgeLength / horizontalSegments;
        }
        
        // Линии сетки (вертикальные)
        for (let h = 0; h <= horizontalSegments; h++) {
            const t = h / horizontalSegments;
            const x = p1.x + (p2.x - p1.x) * t;
            const y = p1.y + (p2.y - p1.y) * t;
            
            const linePoints = [
                new THREE.Vector3(x, y, 0),
                new THREE.Vector3(x, y, height)
            ];
            
            const geometry = new THREE.BufferGeometry().setFromPoints(linePoints);
            const line = new THREE.Line(geometry, this.gridLineMaterial.clone());
            this.gridLinesGroup.add(line);
        }
        
        // Линии сетки (горизонтальные)
        for (let v = 0; v <= levels; v++) {
            const z = v * this.verticalStep;
            if (z > height) break;
            
            const linePoints = [
                new THREE.Vector3(p1.x, p1.y, z),
                new THREE.Vector3(p2.x, p2.y, z)
            ];
            
            const geometry = new THREE.BufferGeometry().setFromPoints(linePoints);
            const line = new THREE.Line(geometry, this.gridLineMaterial.clone());
            this.gridLinesGroup.add(line);
        }
        
        // Расчётные точки
        for (let v = 0; v < levels; v++) {
            const z = (v + 0.5) * this.verticalStep;
            if (z > height) break;
            
            for (let h = 0; h < horizontalSegments; h++) {
                const t = (h + 0.5) / horizontalSegments;
                
                const x = p1.x + (p2.x - p1.x) * t;
                const y = p1.y + (p2.y - p1.y) * t;
                
                // Смещение от фасада
                const position = new THREE.Vector3(
                    x + normal.x * this.offset,
                    y + normal.y * this.offset,
                    z
                );
                
                // Визуальная точка (увеличенный размер)
                const pointGeometry = new THREE.SphereGeometry(this.pointSize, 12, 12);
                const pointMesh = new THREE.Mesh(pointGeometry, this.pointMaterial.clone());
                pointMesh.position.copy(position);
                pointMesh.userData = { 
                    type: 'insolation-point',
                    index: this.calculationPoints.length 
                };
                this.pointsGroup.add(pointMesh);
                
                // Данные точки
                this.calculationPoints.push({
                    index: this.calculationPoints.length,
                    position: position.clone(),
                    normal: normal.clone(),
                    facadeIndex: facadeIndex,
                    level: v,
                    horizontalIndex: h,
                    mesh: pointMesh,
                    selected: false,
                    result: null
                });
            }
        }
    }
    
    /**
     * Извлечь базовые точки здания
     */
    _extractBasePoints(mesh) {
        const pos = mesh.position;
        
        if (mesh.userData.basePoints && mesh.userData.basePoints.length >= 3) {
            return mesh.userData.basePoints.map(p => ({ x: p.x, y: p.y }));
        }
        
        const params = mesh.geometry.parameters;
        if (params && params.shapes) {
            const shape = params.shapes;
            const shapePoints = shape.getPoints ? shape.getPoints() : null;
            
            if (shapePoints && shapePoints.length >= 3) {
                return shapePoints.map(p => ({ 
                    x: p.x + pos.x, 
                    y: p.y + pos.y 
                }));
            }
        }
        
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
                const x = parseFloat((position.getX(i) + pos.x).toFixed(2));
                const y = parseFloat((position.getY(i) + pos.y).toFixed(2));
                const key = `${x},${y}`;
                
                if (!pointsMap.has(key)) {
                    pointsMap.set(key, { x, y });
                }
            }
        }
        
        let points = Array.from(pointsMap.values());
        if (points.length < 3) return null;
        
        const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
        const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
        
        points.sort((a, b) => {
            return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx);
        });
        
        return points;
    }
    
    /**
     * Включить выбор точек
     */
    _enableSelection() {
        if (this._enabled) return;
        this._enabled = true;
        this.renderer.domElement.addEventListener('click', this._boundOnClick);
    }
    
    /**
     * Выключить выбор точек
     */
    _disableSelection() {
        this._enabled = false;
        this.renderer.domElement.removeEventListener('click', this._boundOnClick);
    }
    
    /**
     * Обработка клика
     */
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
    
    /**
     * Переключить выбор точки
     */
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
        
        console.log(`[InsolationGrid] Выбрано точек: ${this.selectedPoints.size}`);
    }
    
    /**
     * Выбрать все точки
     */
    selectAll() {
        this.calculationPoints.forEach((point, index) => {
            if (!point.selected) {
                point.selected = true;
                point.mesh.material.color.setHex(0x1a73e8);
                this.selectedPoints.add(index);
            }
        });
    }
    
    /**
     * Снять выбор со всех
     */
    deselectAll() {
        this.calculationPoints.forEach((point) => {
            if (point.selected) {
                point.selected = false;
                point.mesh.material.color.setHex(0xffffff);
            }
        });
        this.selectedPoints.clear();
    }
    
    /**
     * Получить выбранные точки
     */
    getSelectedPoints() {
        return Array.from(this.selectedPoints).map(i => this.calculationPoints[i]);
    }
    
    /**
     * Установить результат для точки
     */
    setPointResult(index, result) {
        const point = this.calculationPoints[index];
        if (!point) return;
        
        point.result = result;
        
        let color;
        switch (result.status) {
            case 'PASS':
                color = 0x34a853;
                break;
            case 'WARNING':
                color = 0xfbbc04;
                break;
            case 'FAIL':
                color = 0xea4335;
                break;
            default:
                color = 0x888888;
        }
        
        point.mesh.material.color.setHex(color);
    }
    
    /**
     * Сбросить результаты
     */
    resetResults() {
        this.calculationPoints.forEach(point => {
            point.result = null;
            point.mesh.material.color.setHex(point.selected ? 0x1a73e8 : 0xffffff);
        });
    }
    
    /**
     * Очистить сетку
     */
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
        this.activeMesh = null;
    }
    
    /**
     * Показать/скрыть сетку
     */
    setGridVisible(visible) {
        if (this.gridLinesGroup) {
            this.gridLinesGroup.visible = visible;
        }
    }
    
    /**
     * Показать/скрыть точки
     */
    setPointsVisible(visible) {
        if (this.pointsGroup) {
            this.pointsGroup.visible = visible;
        }
    }
    
    getCalculationPoints() {
        return this.calculationPoints;
    }
    
    getActiveMesh() {
        return this.activeMesh;
    }
    
    hasGrid() {
        return this.calculationPoints.length > 0;
    }
}

export { InsolationGrid };
window.InsolationGrid = InsolationGrid;