/**
 * ============================================
 * VertexEditor.js
 * Редактирование вершин зданий
 * ============================================
 */

class VertexEditor {
    constructor(sceneManager, coordinates, options = {}) {
        this.sceneManager = sceneManager;
        this.scene = sceneManager.scene;
        this.camera = sceneManager.camera;
        this.renderer = sceneManager.renderer;
        this.controls = sceneManager.controls;
        this.buildingsGroup = sceneManager.getBuildingsGroup();
        this.coordinates = coordinates;
        
        this.enabled = false;
        this.activeMesh = null;
        this.storedHeight = 9;
        
        this.vertexHelpers = [];
        this.edgeHelpers = [];
        this.points = [];
        
        this.flatMesh = null;
        this.outlineLine = null;
        
        this.selectedVertexIndex = null;
        this.isDragging = false;
        
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        
        // Материалы
        this.vertexMaterial = new THREE.MeshBasicMaterial({ color: 0x4a90d9 });
        this.vertexHoverMaterial = new THREE.MeshBasicMaterial({ color: 0xff6b6b });
        this.edgeMaterial = new THREE.MeshBasicMaterial({ 
            color: 0x00cc00, 
            transparent: true, 
            opacity: 0.5 
        });
        this.flatMaterial = new THREE.MeshBasicMaterial({ 
            color: 0x4a90d9, 
            transparent: true, 
            opacity: 0.4,
            side: THREE.DoubleSide
        });
        this.outlineMaterial = new THREE.LineBasicMaterial({ color: 0x2266aa, linewidth: 2 });
        
        this.onChange = options.onChange || (() => {});
        
        this._boundOnMouseDown = this._onMouseDown.bind(this);
        this._boundOnMouseMove = this._onMouseMove.bind(this);
        this._boundOnMouseUp = this._onMouseUp.bind(this);
        this._boundOnDblClick = this._onDblClick.bind(this);
        this._boundOnKeyDown = this._onKeyDown.bind(this);
        this._boundOnContextMenu = this._onContextMenu.bind(this);
        
        console.log('[VertexEditor] Создан');
    }
    
    enable() {
        this.enabled = true;
        this.renderer.domElement.addEventListener('mousedown', this._boundOnMouseDown);
        this.renderer.domElement.addEventListener('mousemove', this._boundOnMouseMove);
        this.renderer.domElement.addEventListener('mouseup', this._boundOnMouseUp);
        this.renderer.domElement.addEventListener('dblclick', this._boundOnDblClick);
        this.renderer.domElement.addEventListener('contextmenu', this._boundOnContextMenu);
        document.addEventListener('keydown', this._boundOnKeyDown);
        this.renderer.domElement.style.cursor = 'crosshair';
        console.log('[VertexEditor] Включен');
    }
    
    disable() {
        this.enabled = false;
        this.renderer.domElement.removeEventListener('mousedown', this._boundOnMouseDown);
        this.renderer.domElement.removeEventListener('mousemove', this._boundOnMouseMove);
        this.renderer.domElement.removeEventListener('mouseup', this._boundOnMouseUp);
        this.renderer.domElement.removeEventListener('dblclick', this._boundOnDblClick);
        this.renderer.domElement.removeEventListener('contextmenu', this._boundOnContextMenu);
        document.removeEventListener('keydown', this._boundOnKeyDown);
        this.renderer.domElement.style.cursor = 'default';
        
        this._finishEditing();
        console.log('[VertexEditor] Выключен');
    }
    
    _getMousePosition(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }
    
    /**
     * Извлечь точки из mesh (работает для всех типов зданий)
     */
    _extractPoints(mesh) {
        const pos = mesh.position;
        
        // 1. Проверяем сохранённые basePoints
        if (mesh.userData.basePoints && mesh.userData.basePoints.length >= 3) {
            console.log('[VertexEditor] Точки из basePoints:', mesh.userData.basePoints.length);
            return mesh.userData.basePoints.map(p => ({ x: p.x, y: p.y }));
        }
        
        // 2. Пробуем из Shape (ExtrudeGeometry или ShapeGeometry)
        const params = mesh.geometry.parameters;
        if (params && params.shapes) {
            const shape = params.shapes;
            const shapePoints = shape.getPoints ? shape.getPoints() : null;
            
            if (shapePoints && shapePoints.length >= 3) {
                console.log('[VertexEditor] Точки из Shape:', shapePoints.length);
                return shapePoints.map(p => ({ 
                    x: p.x + pos.x, 
                    y: p.y + pos.y 
                }));
            }
        }
        
        // 3. Извлекаем из BufferGeometry (для зданий из OSM)
        const position = mesh.geometry.getAttribute('position');
        if (!position) {
            console.warn('[VertexEditor] Нет position attribute');
            return null;
        }
        
        // Находим минимальный Z (нижняя грань)
        let minZ = Infinity;
        for (let i = 0; i < position.count; i++) {
            const z = position.getZ(i);
            if (z < minZ) minZ = z;
        }
        
        // Собираем уникальные точки нижней грани
        const pointsMap = new Map();
        const tolerance = 0.5;
        
        for (let i = 0; i < position.count; i++) {
            const z = position.getZ(i);
            if (Math.abs(z - minZ) < tolerance) {
                const x = parseFloat((position.getX(i) + pos.x).toFixed(2));
                const y = parseFloat((position.getY(i) + pos.y).toFixed(2));
                const key = `${x},${y}`;
                
                if (!pointsMap.has(key)) {
                    pointsMap.set(key, { x, y });
                }
            }
        }
        
        let points = Array.from(pointsMap.values());
        
        if (points.length < 3) {
            console.warn('[VertexEditor] Мало точек:', points.length);
            return null;
        }
        
        // Сортируем по углу от центра для правильного порядка
        const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
        const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
        
        points.sort((a, b) => {
            const angleA = Math.atan2(a.y - cy, a.x - cx);
            const angleB = Math.atan2(b.y - cy, b.x - cx);
            return angleA - angleB;
        });
        
        console.log('[VertexEditor] Точки из geometry:', points.length);
        return points;
    }
    
    /**
     * Начать редактирование здания
     */
    startEditing(mesh) {
        if (!mesh) return;
        if (this.activeMesh === mesh) return;
        
        // Завершаем предыдущее редактирование
        this._finishEditing();
        
        console.log('[VertexEditor] Начинаем редактирование:', mesh.userData.id);
        
        this.activeMesh = mesh;
        this.storedHeight = mesh.userData.properties?.height || 9;
        
        // Извлекаем точки
        this.points = this._extractPoints(mesh);
        
        if (!this.points || this.points.length < 3) {
            console.warn('[VertexEditor] Не удалось извлечь точки из здания');
            this.activeMesh = null;
            return;
        }
        
        // Скрываем оригинальный mesh
        mesh.visible = false;
        
        // Создаём плоское представление
        this._createFlatView();
        this._createHelpers();
        
        console.log(`[VertexEditor] Редактирование: ${mesh.userData.id}, ${this.points.length} вершин`);
    }
    
    /**
     * Завершить редактирование
     */
    _finishEditing() {
        if (!this.activeMesh) return;
        
        console.log('[VertexEditor] Завершаем редактирование:', this.activeMesh.userData.id);
        
        // Пересоздаём 3D mesh
        this._rebuildMesh();
        
        // Показываем
        this.activeMesh.visible = true;
        
        // Удаляем визуальные элементы
        this._removeFlatView();
        this._clearHelpers();
        
        this.onChange(this.activeMesh);
        
        this.activeMesh = null;
        this.points = [];
        this.selectedVertexIndex = null;
    }
    
    /**
     * Создать плоское представление
     */
    _createFlatView() {
        this._removeFlatView();
        
        if (this.points.length < 3) return;
        
        const shapePoints = this.points.map(p => new THREE.Vector2(p.x, p.y));
        const shape = new THREE.Shape(shapePoints);
        
        // Плоский полигон
        const geometry = new THREE.ShapeGeometry(shape);
        this.flatMesh = new THREE.Mesh(geometry, this.flatMaterial.clone());
        this.flatMesh.position.z = 0.05;
        this.flatMesh.userData.isHelper = true;
        this.scene.add(this.flatMesh);
        
        // Контур
        const linePoints = [...this.points, this.points[0]].map(p => 
            new THREE.Vector3(p.x, p.y, 0.15)
        );
        const lineGeometry = new THREE.BufferGeometry().setFromPoints(linePoints);
        this.outlineLine = new THREE.Line(lineGeometry, this.outlineMaterial.clone());
        this.outlineLine.userData.isHelper = true;
        this.scene.add(this.outlineLine);
    }
    
    _removeFlatView() {
        if (this.flatMesh) {
            this.scene.remove(this.flatMesh);
            this.flatMesh.geometry.dispose();
            this.flatMesh.material.dispose();
            this.flatMesh = null;
        }
        
        if (this.outlineLine) {
            this.scene.remove(this.outlineLine);
            this.outlineLine.geometry.dispose();
            this.outlineLine.material.dispose();
            this.outlineLine = null;
        }
    }
    
    _updateFlatView() {
        this._createFlatView();
    }
    
    /**
     * Создать helpers для вершин и рёбер
     */
    _createHelpers() {
        this._clearHelpers();
        
        // Вершины (синие сферы)
        this.points.forEach((point, index) => {
            const geometry = new THREE.SphereGeometry(1.5, 12, 12);
            const material = this.vertexMaterial.clone();
            const helper = new THREE.Mesh(geometry, material);
            helper.position.set(point.x, point.y, 0.2);
            helper.userData = { type: 'vertex', index: index, isHelper: true };
            this.scene.add(helper);
            this.vertexHelpers.push(helper);
        });
        
        // Точки на рёбрах (зелёные, меньше)
        for (let i = 0; i < this.points.length; i++) {
            const p1 = this.points[i];
            const p2 = this.points[(i + 1) % this.points.length];
            
            const geometry = new THREE.SphereGeometry(1, 12, 12);
            const material = this.edgeMaterial.clone();
            const helper = new THREE.Mesh(geometry, material);
            helper.position.set((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, 0.2);
            helper.userData = { type: 'edge', index: i, isHelper: true };
            this.scene.add(helper);
            this.edgeHelpers.push(helper);
        }
    }
    
    _clearHelpers() {
        for (const h of this.vertexHelpers) {
            this.scene.remove(h);
            h.geometry.dispose();
            h.material.dispose();
        }
        for (const h of this.edgeHelpers) {
            this.scene.remove(h);
            h.geometry.dispose();
            h.material.dispose();
        }
        this.vertexHelpers = [];
        this.edgeHelpers = [];
    }
    
    _updateHelpers() {
        // Обновляем позиции вершин
        this.points.forEach((point, i) => {
            if (this.vertexHelpers[i]) {
                this.vertexHelpers[i].position.set(point.x, point.y, 0.2);
            }
        });
        
        // Обновляем позиции точек на рёбрах
        for (let i = 0; i < this.edgeHelpers.length; i++) {
            const p1 = this.points[i];
            const p2 = this.points[(i + 1) % this.points.length];
            this.edgeHelpers[i].position.set(
                (p1.x + p2.x) / 2,
                (p1.y + p2.y) / 2,
                0.2
            );
        }
    }
    
    _raycastHelpers() {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        // Сначала вершины
        const vertexHits = this.raycaster.intersectObjects(this.vertexHelpers, false);
        if (vertexHits.length > 0) {
            return { 
                type: 'vertex', 
                helper: vertexHits[0].object, 
                index: vertexHits[0].object.userData.index 
            };
        }
        
        // Потом рёбра
        const edgeHits = this.raycaster.intersectObjects(this.edgeHelpers, false);
        if (edgeHits.length > 0) {
            return { 
                type: 'edge', 
                helper: edgeHits[0].object, 
                index: edgeHits[0].object.userData.index 
            };
        }
        
        return null;
    }
    
    _raycastBuildings() {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        // Собираем все здания (видимые и невидимые, но не helpers)
        const targets = [];
        
        for (const child of this.buildingsGroup.children) {
            if (child.userData.type === 'building' && !child.userData.isHelper) {
                targets.push(child);
            }
        }
        
        // Также проверяем flatMesh
        if (this.flatMesh) {
            targets.push(this.flatMesh);
        }
        
        const intersects = this.raycaster.intersectObjects(targets, false);
        
        for (const hit of intersects) {
            // Если кликнули по flatMesh — возвращаем activeMesh
            if (hit.object === this.flatMesh) {
                return this.activeMesh;
            }
            // Если здание видимое
            if (hit.object.visible) {
                return hit.object;
            }
        }
        
        return null;
    }
    
    _onMouseDown(event) {
        if (!this.enabled) return;
        if (event.button !== 0) return;
        
        this._getMousePosition(event);
        
        // Если есть активное редактирование — проверяем helpers
        if (this.activeMesh) {
            const hit = this._raycastHelpers();
            
            if (hit && hit.type === 'vertex') {
                // Начинаем перетаскивание вершины
                this.selectedVertexIndex = hit.index;
                this.isDragging = true;
                this.controls.enabled = false;
                
                // Подсветка
                hit.helper.material.color.setHex(0xff6b6b);
                
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            
            if (hit && hit.type === 'edge') {
                // Добавляем вершину на ребро
                this._addVertexAtEdge(hit.index);
                event.preventDefault();
                event.stopPropagation();
                return;
            }
        }
        
        // Проверяем клик по зданию
        const mesh = this._raycastBuildings();
        
        console.log('[VertexEditor] Клик по:', mesh ? mesh.userData.id : 'пусто');
        
        if (mesh && mesh !== this.activeMesh) {
            // Клик по другому зданию — начинаем редактирование
            this.startEditing(mesh);
        } else if (!mesh && this.activeMesh) {
            // Клик в пустоту — завершаем редактирование
            this._finishEditing();
        }
    }
    
    _onMouseMove(event) {
        if (!this.enabled) return;
        
        this._getMousePosition(event);
        
        if (this.isDragging && this.selectedVertexIndex !== null) {
            // Перетаскиваем вершину
            this.raycaster.setFromCamera(this.mouse, this.camera);
            
            const intersectPoint = new THREE.Vector3();
            this.raycaster.ray.intersectPlane(this.groundPlane, intersectPoint);
            
            // Обновляем точку
            this.points[this.selectedVertexIndex] = { 
                x: intersectPoint.x, 
                y: intersectPoint.y 
            };
            
            // Обновляем визуализацию
            this._updateFlatView();
            this._updateHelpers();
            
            // Подсветка выбранной вершины
            if (this.vertexHelpers[this.selectedVertexIndex]) {
                this.vertexHelpers[this.selectedVertexIndex].material.color.setHex(0xff6b6b);
            }
            
        } else if (this.activeMesh) {
            // Hover эффект
            const hit = this._raycastHelpers();
            
            // Сбрасываем цвета
            for (const h of this.vertexHelpers) {
                h.material.color.setHex(0x4a90d9);
            }
            for (const h of this.edgeHelpers) {
                h.material.opacity = 0.5;
            }
            
            if (hit) {
                if (hit.type === 'vertex') {
                    hit.helper.material.color.setHex(0xff6b6b);
                    this.renderer.domElement.style.cursor = 'grab';
                } else {
                    hit.helper.material.opacity = 1;
                    this.renderer.domElement.style.cursor = 'copy';
                }
            } else {
                this.renderer.domElement.style.cursor = 'crosshair';
            }
        }
    }
    
    _onMouseUp(event) {
        if (this.isDragging) {
            this.isDragging = false;
            this.controls.enabled = true;
            this.selectedVertexIndex = null;
            
            // Сбрасываем цвета
            for (const h of this.vertexHelpers) {
                h.material.color.setHex(0x4a90d9);
            }
        }
    }
    
    _onDblClick(event) {
        if (!this.enabled || !this.activeMesh) return;
        
        this._getMousePosition(event);
        const hit = this._raycastHelpers();
        
        if (hit && hit.type === 'vertex') {
            this._removeVertex(hit.index);
        }
    }
    
    _onContextMenu(event) {
        event.preventDefault();
        
        if (this.activeMesh) {
            // Правый клик — завершаем редактирование
            this._finishEditing();
        }
    }
    
    _onKeyDown(event) {
        if (!this.enabled) return;
        
        if (event.key === 'Escape' && this.activeMesh) {
            this._finishEditing();
        }
        
        if (event.key === 'Delete' && this.selectedVertexIndex !== null) {
            this._removeVertex(this.selectedVertexIndex);
        }
    }
    
    _addVertexAtEdge(edgeIndex) {
        const p1 = this.points[edgeIndex];
        const p2 = this.points[(edgeIndex + 1) % this.points.length];
        
        const newPoint = {
            x: (p1.x + p2.x) / 2,
            y: (p1.y + p2.y) / 2
        };
        
        this.points.splice(edgeIndex + 1, 0, newPoint);
        
        this._updateFlatView();
        this._createHelpers();
        
        console.log(`[VertexEditor] Добавлена вершина: ${edgeIndex + 1}`);
    }
    
    _removeVertex(index) {
        if (this.points.length <= 3) {
            console.warn('[VertexEditor] Минимум 3 вершины');
            return;
        }
        
        this.points.splice(index, 1);
        
        this._updateFlatView();
        this._createHelpers();
        
        this.selectedVertexIndex = null;
        
        console.log(`[VertexEditor] Удалена вершина: ${index}`);
    }
    
    /**
     * Пересоздать 3D mesh из точек
     */
    _rebuildMesh() {
        if (!this.activeMesh || this.points.length < 3) return;
        
        const shapePoints = this.points.map(p => new THREE.Vector2(p.x, p.y));
        
        // Проверяем ориентацию (должна быть CCW)
        if (THREE.ShapeUtils.isClockWise(shapePoints)) {
            shapePoints.reverse();
            this.points.reverse();
        }
        
        const shape = new THREE.Shape(shapePoints);
        
        // Создаём 3D геометрию
        const newGeometry = new THREE.ExtrudeGeometry(shape, {
            depth: this.storedHeight,
            bevelEnabled: false
        });
        
        // Заменяем геометрию
        this.activeMesh.geometry.dispose();
        this.activeMesh.geometry = newGeometry;
        
        // Сбрасываем позицию (точки уже в мировых координатах)
        this.activeMesh.position.set(0, 0, 0);
        
        // Обновляем материал
        this.activeMesh.material.opacity = 0.9;
        this.activeMesh.material.transparent = true;
        
        // Сохраняем точки
        this.activeMesh.userData.basePoints = this.points.map(p => ({ x: p.x, y: p.y }));
        this.activeMesh.userData.isFlat = false;
        
        console.log('[VertexEditor] Mesh пересоздан');
    }
    
    isActive() {
        return this.activeMesh !== null;
    }
}

export { VertexEditor };
window.VertexEditor = VertexEditor;