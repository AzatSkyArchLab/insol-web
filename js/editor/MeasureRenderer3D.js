/**
 * ============================================
 * MeasureRenderer3D.js
 * Рендеринг измерений с карты в 3D сцене
 * ============================================
 */

class MeasureRenderer3D {
    constructor(sceneManager, coordinates) {
        this.sceneManager = sceneManager;
        this.coordinates = coordinates;
        
        this.group = sceneManager.getMeasurementsGroup();
        
        // Материалы
        this.lineMaterial = new THREE.LineBasicMaterial({ 
            color: 0xff4444, 
            linewidth: 2 
        });
        this.polygonMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xff4444, 
            transparent: true, 
            opacity: 0.25,
            side: THREE.DoubleSide
        });
        this.outlineMaterial = new THREE.LineBasicMaterial({ 
            color: 0xff4444, 
            linewidth: 2 
        });
        this.pointMaterial = new THREE.MeshBasicMaterial({ color: 0xff4444 });
        this.selectedMaterial = new THREE.MeshBasicMaterial({ 
            color: 0x00ff00, 
            transparent: true, 
            opacity: 0.4,
            side: THREE.DoubleSide
        });
        
        // Хранилище измерений
        this.measurementMeshes = new Map(); // id -> { meshes: [], data: {} }
        this.measurementIdCounter = 0;
        
        // DOM контейнер для меток
        this.labelsContainer = null;
        this.labels = [];
        
        // Выбранное измерение
        this.selectedId = null;
        
        console.log('[MeasureRenderer3D] Создан');
    }
    
    /**
     * Загрузить измерения с карты
     * @param {Array} measurements - массив измерений из MapMeasureTool
     */
    loadFromMap(measurements) {
        this.clear();
        
        if (!measurements || measurements.length === 0) {
            console.log('[MeasureRenderer3D] Нет измерений для загрузки');
            return;
        }
        
        this._createLabelsContainer();
        
        measurements.forEach(m => {
            // Обновляем счётчик чтобы новые ID не пересекались
            if (m.id >= this.measurementIdCounter) {
                this.measurementIdCounter = m.id;
            }
            this._createMeasurement(m);
        });
        
        console.log(`[MeasureRenderer3D] Загружено ${measurements.length} измерений`);
    }
    
    /**
     * Добавить измерение из 3D сцены (линейка)
     * @param {Array} points3D - массив THREE.Vector3 точек в координатах сцены
     * @param {string} type - 'line' | 'polygon'
     * @returns {number} - ID созданного измерения
     */
    addMeasurementFromScene(points3D, type = 'line') {
        if (!points3D || points3D.length < 2) return null;
        if (type === 'polygon' && points3D.length < 3) return null;
        
        this._createLabelsContainer();
        
        // Вычисляем расстояние
        let distance = 0;
        for (let i = 1; i < points3D.length; i++) {
            distance += points3D[i - 1].distanceTo(points3D[i]);
        }
        
        // Вычисляем площадь для полигона
        let area = null;
        if (type === 'polygon') {
            area = this._calculateArea3D(points3D);
        }
        
        const id = ++this.measurementIdCounter;
        
        // Конвертируем в geo-координаты для синхронизации с картой
        const geoPoints = points3D.map(p => this._toGeoCoords(p.x, p.y));
        
        const measurement = {
            id,
            type,
            points: geoPoints, // [lng, lat] для совместимости с картой
            distance,
            area
        };
        
        // Конвертируем Vector3 в простые объекты {x, y}
        const pointsSimple = points3D.map(p => ({ x: p.x, y: p.y }));
        
        this._createMeasurement3D(measurement, pointsSimple);
        
        // Синхронизируем с mapMeasureTool если доступен
        this._syncToMapMeasureTool(measurement);
        
        console.log(`[MeasureRenderer3D] Добавлено измерение #${id} из сцены`);
        
        return id;
    }
    
    /**
     * Конвертация координат сцены в geo-координаты
     */
    _toGeoCoords(x, y) {
        const coords = this.coordinates;
        return [
            coords.centerLon + x / coords.metersPerDegreeLon,
            coords.centerLat + y / coords.metersPerDegreeLat
        ];
    }
    
    /**
     * Синхронизация с mapMeasureTool
     */
    _syncToMapMeasureTool(measurement) {
        const mapMeasureTool = window.app?.state?.mapMeasureTool;
        if (!mapMeasureTool) return;
        
        // Добавляем в массив измерений карты
        mapMeasureTool.measurements.push(measurement);
        
        // Обновляем счётчик ID карты
        if (measurement.id >= mapMeasureTool.measurementIdCounter) {
            mapMeasureTool.measurementIdCounter = measurement.id;
        }
    }
    
    /**
     * Создать 3D объект измерения (для точек уже в координатах сцены)
     */
    _createMeasurement3D(measurement, points3D) {
        const { id, type, distance, area } = measurement;
        
        const meshes = [];
        
        if (type === 'polygon') {
            // Полигон
            const shape = new THREE.Shape();
            shape.moveTo(points3D[0].x, points3D[0].y);
            for (let i = 1; i < points3D.length; i++) {
                shape.lineTo(points3D[i].x, points3D[i].y);
            }
            shape.closePath();
            
            const geometry = new THREE.ShapeGeometry(shape);
            const mesh = new THREE.Mesh(geometry, this.polygonMaterial.clone());
            mesh.position.z = 0.5;
            mesh.userData = { 
                type: 'measurement', 
                subtype: 'polygon',
                measureId: id,
                area,
                distance
            };
            this.group.add(mesh);
            meshes.push(mesh);
            
            // Контур
            const outlinePoints = [...points3D, points3D[0]].map(p => new THREE.Vector3(p.x, p.y, 0.6));
            const outlineGeometry = new THREE.BufferGeometry().setFromPoints(outlinePoints);
            const outline = new THREE.Line(outlineGeometry, this.outlineMaterial);
            this.group.add(outline);
            meshes.push(outline);
            
        } else {
            // Линия
            const linePoints = points3D.map(p => new THREE.Vector3(p.x, p.y, 0.5));
            const geometry = new THREE.BufferGeometry().setFromPoints(linePoints);
            const line = new THREE.Line(geometry, this.lineMaterial);
            line.userData = { 
                type: 'measurement', 
                subtype: 'line',
                measureId: id,
                distance
            };
            this.group.add(line);
            meshes.push(line);
        }
        
        // Точки
        points3D.forEach((p, i) => {
            const sphere = new THREE.Mesh(
                new THREE.SphereGeometry(1.2, 16, 16),
                this.pointMaterial.clone()
            );
            sphere.position.set(p.x, p.y, 0.5);
            sphere.userData = { 
                type: 'measurement-point', 
                measureId: id, 
                pointIndex: i 
            };
            this.group.add(sphere);
            meshes.push(sphere);
        });
        
        // Метка
        this._createLabel3D(measurement, points3D);
        
        // Сохраняем
        this.measurementMeshes.set(id, { meshes, data: measurement });
    }
    
    /**
     * Создать DOM-метку для 3D измерения
     */
    _createLabel3D(measurement, points3D) {
        const { id, type, area, distance } = measurement;
        
        // Центр
        let center;
        if (type === 'polygon') {
            center = { x: 0, y: 0, z: 1 };
            points3D.forEach(p => {
                center.x += p.x;
                center.y += p.y;
            });
            center.x /= points3D.length;
            center.y /= points3D.length;
        } else {
            const mid = Math.floor(points3D.length / 2);
            center = { x: points3D[mid].x, y: points3D[mid].y, z: 1 };
        }
        
        const label = document.createElement('div');
        label.className = 'measure-3d-label';
        label.dataset.measureId = id;
        
        if (type === 'polygon') {
            label.innerHTML = `<strong>${this._formatArea(area)}</strong><br><span>${this._formatDistance(distance)}</span>`;
        } else {
            label.innerHTML = `<strong>${this._formatDistance(distance)}</strong>`;
        }
        
        label._position = new THREE.Vector3(center.x, center.y, center.z);
        
        this.labelsContainer.appendChild(label);
        this.labels.push(label);
        
        this._updateLabelPosition(label);
    }
    
    /**
     * Вычислить площадь для 3D точек (Shoelace formula)
     */
    _calculateArea3D(points3D) {
        if (points3D.length < 3) return 0;
        
        let area = 0;
        for (let i = 0; i < points3D.length; i++) {
            const j = (i + 1) % points3D.length;
            area += points3D[i].x * points3D[j].y;
            area -= points3D[j].x * points3D[i].y;
        }
        
        return Math.abs(area) / 2;
    }
    
    /**
     * Создать 3D объект измерения
     */
    _createMeasurement(measurement) {
        const { id, type, points, distance, area } = measurement;
        
        // Конвертируем координаты в метры
        const points3D = points.map(p => this._toSceneCoords(p[0], p[1]));
        
        const meshes = [];
        
        if (type === 'polygon') {
            // Полигон
            const shape = new THREE.Shape();
            shape.moveTo(points3D[0].x, points3D[0].y);
            for (let i = 1; i < points3D.length; i++) {
                shape.lineTo(points3D[i].x, points3D[i].y);
            }
            shape.closePath();
            
            const geometry = new THREE.ShapeGeometry(shape);
            const mesh = new THREE.Mesh(geometry, this.polygonMaterial.clone());
            mesh.position.z = 0.5;
            mesh.userData = { 
                type: 'measurement', 
                subtype: 'polygon',
                measureId: id,
                area,
                distance
            };
            this.group.add(mesh);
            meshes.push(mesh);
            
            // Контур
            const outlinePoints = [...points3D, points3D[0]].map(p => new THREE.Vector3(p.x, p.y, 0.6));
            const outlineGeometry = new THREE.BufferGeometry().setFromPoints(outlinePoints);
            const outline = new THREE.Line(outlineGeometry, this.outlineMaterial);
            this.group.add(outline);
            meshes.push(outline);
            
        } else {
            // Линия
            const linePoints = points3D.map(p => new THREE.Vector3(p.x, p.y, 0.5));
            const geometry = new THREE.BufferGeometry().setFromPoints(linePoints);
            const line = new THREE.Line(geometry, this.lineMaterial);
            line.userData = { 
                type: 'measurement', 
                subtype: 'line',
                measureId: id,
                distance
            };
            this.group.add(line);
            meshes.push(line);
        }
        
        // Точки
        points3D.forEach((p, i) => {
            const sphere = new THREE.Mesh(
                new THREE.SphereGeometry(1.2, 16, 16),
                this.pointMaterial
            );
            sphere.position.set(p.x, p.y, 0.5);
            sphere.userData = { 
                type: 'measurement-point', 
                measureId: id, 
                pointIndex: i 
            };
            this.group.add(sphere);
            meshes.push(sphere);
        });
        
        // Метка
        this._createLabel(measurement, points3D);
        
        // Сохраняем
        this.measurementMeshes.set(id, { meshes, data: measurement });
    }
    
    /**
     * Конвертация координат в метры сцены
     */
    _toSceneCoords(lng, lat) {
        const coords = this.coordinates;
        return {
            x: (lng - coords.centerLon) * coords.metersPerDegreeLon,
            y: (lat - coords.centerLat) * coords.metersPerDegreeLat
        };
    }
    
    /**
     * Создать DOM-метку
     */
    _createLabel(measurement, points3D) {
        const { id, type, area, distance } = measurement;
        
        // Центр
        let center;
        if (type === 'polygon') {
            center = { x: 0, y: 0, z: 1 };
            points3D.forEach(p => {
                center.x += p.x;
                center.y += p.y;
            });
            center.x /= points3D.length;
            center.y /= points3D.length;
        } else {
            const mid = Math.floor(points3D.length / 2);
            center = { x: points3D[mid].x, y: points3D[mid].y, z: 1 };
        }
        
        const label = document.createElement('div');
        label.className = 'measure-3d-label';
        label.dataset.measureId = id;
        
        if (type === 'polygon') {
            label.innerHTML = `<strong>${this._formatArea(area)}</strong><br><span>${this._formatDistance(distance)}</span>`;
        } else {
            label.innerHTML = `<strong>${this._formatDistance(distance)}</strong>`;
        }
        
        label._position = new THREE.Vector3(center.x, center.y, center.z);
        
        this.labelsContainer.appendChild(label);
        this.labels.push(label);
        
        this._updateLabelPosition(label);
    }
    
    _createLabelsContainer() {
        if (this.labelsContainer) return;
        
        this.labelsContainer = document.createElement('div');
        this.labelsContainer.id = 'measure-3d-labels';
        this.labelsContainer.style.cssText = `
            position: absolute;
            top: 0; left: 0;
            width: 100%; height: 100%;
            pointer-events: none;
            z-index: 50;
        `;
        document.getElementById('scene-container').appendChild(this.labelsContainer);
    }
    
    _updateLabelPosition(label) {
        if (!label._position) return;
        
        const vector = label._position.clone();
        vector.project(this.sceneManager.camera);
        
        const rect = this.sceneManager.renderer.domElement.getBoundingClientRect();
        const x = (vector.x * 0.5 + 0.5) * rect.width;
        const y = (-vector.y * 0.5 + 0.5) * rect.height;
        
        if (vector.z > 1) {
            label.style.display = 'none';
        } else {
            label.style.display = 'block';
            label.style.left = x + 'px';
            label.style.top = y + 'px';
        }
    }
    
    updateLabels() {
        this.labels.forEach(label => this._updateLabelPosition(label));
    }
    
    /**
     * Выбрать измерение
     */
    select(id) {
        this.deselect();
        
        const item = this.measurementMeshes.get(id);
        if (!item) return;
        
        this.selectedId = id;
        
        // Меняем цвет полигона/линии
        const mainMesh = item.meshes[0];
        if (mainMesh.material) {
            mainMesh._originalMaterial = mainMesh.material;
            mainMesh.material = this.selectedMaterial.clone();
        }
        
        // Подсвечиваем метку
        const label = this.labelsContainer?.querySelector(`[data-measure-id="${id}"]`);
        if (label) {
            label.classList.add('selected');
        }
        
        console.log(`[MeasureRenderer3D] Выбрано измерение #${id}`);
    }
    
    /**
     * Снять выделение
     */
    deselect() {
        if (this.selectedId === null) return;
        
        const item = this.measurementMeshes.get(this.selectedId);
        if (item) {
            const mainMesh = item.meshes[0];
            if (mainMesh._originalMaterial) {
                mainMesh.material = mainMesh._originalMaterial;
                delete mainMesh._originalMaterial;
            }
        }
        
        const label = this.labelsContainer?.querySelector(`[data-measure-id="${this.selectedId}"]`);
        if (label) {
            label.classList.remove('selected');
        }
        
        this.selectedId = null;
    }
    
    /**
     * Удалить измерение
     */
    remove(id) {
        const item = this.measurementMeshes.get(id);
        if (!item) return;
        
        // Удаляем меши
        item.meshes.forEach(mesh => {
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) mesh.material.dispose();
            this.group.remove(mesh);
        });
        
        // Удаляем метку
        const label = this.labelsContainer?.querySelector(`[data-measure-id="${id}"]`);
        if (label) {
            this.labels = this.labels.filter(l => l !== label);
            label.remove();
        }
        
        this.measurementMeshes.delete(id);
        
        if (this.selectedId === id) {
            this.selectedId = null;
        }
        
        // Синхронизируем удаление с mapMeasureTool
        this._removeFromMapMeasureTool(id);
        
        console.log(`[MeasureRenderer3D] Удалено измерение #${id}`);
    }
    
    /**
     * Удалить измерение из mapMeasureTool
     */
    _removeFromMapMeasureTool(id) {
        const mapMeasureTool = window.app?.state?.mapMeasureTool;
        if (!mapMeasureTool) return;
        
        mapMeasureTool.measurements = mapMeasureTool.measurements.filter(m => m.id !== id);
        
        // Удаляем метку на карте если есть
        const label = mapMeasureTool.labelsContainer?.querySelector(`[data-measure-id="${id}"]`);
        if (label) {
            mapMeasureTool.labels = mapMeasureTool.labels.filter(l => l !== label);
            label.remove();
        }
        
        // Обновляем слои карты
        mapMeasureTool._updateLayers?.();
        mapMeasureTool._updateInfoPanel?.();
    }
    
    /**
     * Удалить выбранное
     */
    removeSelected() {
        if (this.selectedId !== null) {
            this.remove(this.selectedId);
            return true;
        }
        return false;
    }
    
    /**
     * Очистить все измерения
     */
    clear() {
        this.measurementMeshes.forEach((item, id) => {
            item.meshes.forEach(mesh => {
                if (mesh.geometry) mesh.geometry.dispose();
                if (mesh.material) mesh.material.dispose();
                this.group.remove(mesh);
            });
        });
        this.measurementMeshes.clear();
        
        // Удаляем метки
        this.labels.forEach(label => label.remove());
        this.labels = [];
        
        this.selectedId = null;
    }
    
    _formatDistance(meters) {
        if (meters < 1) return `${(meters * 100).toFixed(0)} см`;
        if (meters < 1000) return `${meters.toFixed(1)} м`;
        return `${(meters / 1000).toFixed(2)} км`;
    }
    
    _formatArea(sqMeters) {
        if (sqMeters < 1) return `${(sqMeters * 10000).toFixed(0)} см²`;
        if (sqMeters < 10000) return `${sqMeters.toFixed(1)} м²`;
        if (sqMeters < 1000000) return `${(sqMeters / 10000).toFixed(2)} сот.`;
        return `${(sqMeters / 1000000).toFixed(3)} км²`;
    }
    
    dispose() {
        this.clear();
        
        if (this.labelsContainer) {
            this.labelsContainer.remove();
        }
        
        this.lineMaterial.dispose();
        this.polygonMaterial.dispose();
        this.outlineMaterial.dispose();
        this.pointMaterial.dispose();
        this.selectedMaterial.dispose();
    }
}

export { MeasureRenderer3D };
window.MeasureRenderer3D = MeasureRenderer3D;