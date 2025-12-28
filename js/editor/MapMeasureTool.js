/**
 * ============================================
 * MapMeasureTool.js
 * Инструмент измерения на карте
 * - Линии (расстояние)
 * - Полигоны (площадь)
 * ============================================
 */

class MapMeasureTool {
    constructor(mapEngine) {
        this.mapEngine = mapEngine;
        this.map = mapEngine.getMap();
        this.enabled = false;
        
        // Режим: 'line' | 'polygon'
        this.mode = 'line';
        
        // Текущие точки измерения [lng, lat]
        this.currentPoints = [];
        
        // Сохранённые измерения
        this.measurements = [];
        this.measurementIdCounter = 0;
        
        // ID источников и слоёв
        this.sourceId = 'measure-source';
        this.lineLayerId = 'measure-line';
        this.fillLayerId = 'measure-fill';
        this.pointLayerId = 'measure-points';
        this.tempSourceId = 'measure-temp';
        this.tempLineLayerId = 'measure-temp-line';
        
        // DOM элементы
        this.labelsContainer = null;
        this.labels = [];
        this.infoPanel = null;
        
        // Обработчики
        this._onClick = this._onClick.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onDblClick = this._onDblClick.bind(this);
        this._onContextMenu = this._onContextMenu.bind(this);
        
        console.log('[MapMeasureTool] Создан');
    }
    
    enable() {
        if (this.enabled) return;
        this.enabled = true;
        
        this._initLayers();
        this._createUI();
        
        this.map.on('click', this._onClick);
        this.map.on('mousemove', this._onMouseMove);
        this.map.on('dblclick', this._onDblClick);
        this.map.on('contextmenu', this._onContextMenu);
        this.map.getCanvas().style.cursor = 'crosshair';
        
        this._showInfoPanel();
        
        console.log('[MapMeasureTool] Включен');
    }
    
    disable() {
        if (!this.enabled) return;
        this.enabled = false;
        
        this.map.off('click', this._onClick);
        this.map.off('mousemove', this._onMouseMove);
        this.map.off('dblclick', this._onDblClick);
        this.map.off('contextmenu', this._onContextMenu);
        this.map.getCanvas().style.cursor = '';
        
        this._removeTempLine();
        this._hideInfoPanel();
        
        console.log('[MapMeasureTool] Выключен');
    }
    
    setMode(mode) {
        if (mode !== 'line' && mode !== 'polygon') return;
        this.mode = mode;
        this._finishCurrentMeasurement();
        this._updateModeButtons();
        console.log(`[MapMeasureTool] Режим: ${mode}`);
    }
    
    clear() {
        this.currentPoints = [];
        this.measurements = [];
        this._updateLayers();
        this._removeTempLine();
        this._clearLabels();
        this._updateInfoPanel();
        console.log('[MapMeasureTool] Очищен');
    }
    
    clearCurrent() {
        this.currentPoints = [];
        this._updateLayers();
        this._removeTempLine();
    }
    
    _initLayers() {
        // Удаляем существующие слои/источники если есть
        [this.fillLayerId, this.lineLayerId, this.pointLayerId, this.tempLineLayerId].forEach(id => {
            if (this.map.getLayer(id)) this.map.removeLayer(id);
        });
        [this.sourceId, this.tempSourceId].forEach(id => {
            if (this.map.getSource(id)) this.map.removeSource(id);
        });
        
        // Основной источник данных
        this.map.addSource(this.sourceId, {
            type: 'geojson',
            data: this._getGeoJSON()
        });
        
        // Заливка полигонов
        this.map.addLayer({
            id: this.fillLayerId,
            type: 'fill',
            source: this.sourceId,
            filter: ['==', '$type', 'Polygon'],
            paint: {
                'fill-color': '#ff4444',
                'fill-opacity': 0.15
            }
        });
        
        // Линии
        this.map.addLayer({
            id: this.lineLayerId,
            type: 'line',
            source: this.sourceId,
            paint: {
                'line-color': '#ff4444',
                'line-width': 2.5
            }
        });
        
        // Точки
        this.map.addLayer({
            id: this.pointLayerId,
            type: 'circle',
            source: this.sourceId,
            filter: ['==', '$type', 'Point'],
            paint: {
                'circle-radius': 5,
                'circle-color': '#ff4444',
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2
            }
        });
        
        // Временный источник
        this.map.addSource(this.tempSourceId, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
        
        this.map.addLayer({
            id: this.tempLineLayerId,
            type: 'line',
            source: this.tempSourceId,
            paint: {
                'line-color': '#ff8888',
                'line-width': 2,
                'line-dasharray': [3, 3]
            }
        });
    }
    
    _createUI() {
        if (this.labelsContainer) return;
        
        // Контейнер для меток
        this.labelsContainer = document.createElement('div');
        this.labelsContainer.id = 'map-measure-labels';
        this.labelsContainer.style.cssText = `
            position: absolute;
            top: 0; left: 0;
            width: 100%; height: 100%;
            pointer-events: none;
            z-index: 5;
        `;
        document.getElementById('map').appendChild(this.labelsContainer);
        
        // Панель информации
        this.infoPanel = document.createElement('div');
        this.infoPanel.id = 'map-measure-panel';
        this.infoPanel.innerHTML = `
            <div class="measure-panel-header">
                <span>📏 Измерение</span>
                <button class="measure-close-btn" title="Закрыть">✕</button>
            </div>
            <div class="measure-mode-btns">
                <button class="measure-mode-btn active" data-mode="line">
                    <span>📏</span> Линия
                </button>
                <button class="measure-mode-btn" data-mode="polygon">
                    <span>⬡</span> Полигон
                </button>
            </div>
            <div class="measure-info">
                <div class="measure-hint">Кликайте для измерения</div>
                <div class="measure-stats"></div>
            </div>
            <div class="measure-actions">
                <button class="measure-action-btn" data-action="finish" disabled>✓ Завершить</button>
                <button class="measure-action-btn" data-action="clear">🗑 Очистить всё</button>
            </div>
            <div class="measure-list"></div>
        `;
        document.getElementById('map').appendChild(this.infoPanel);
        
        this._bindPanelEvents();
    }
    
    _bindPanelEvents() {
        // Кнопка закрытия
        this.infoPanel.querySelector('.measure-close-btn').addEventListener('click', () => {
            this.disable();
            document.getElementById('map-measure-btn')?.classList.remove('active');
        });
        
        // Переключатели режима
        this.infoPanel.querySelectorAll('.measure-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.setMode(btn.dataset.mode);
            });
        });
        
        // Кнопки действий
        this.infoPanel.querySelectorAll('.measure-action-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                if (action === 'finish') {
                    this._finishCurrentMeasurement();
                } else if (action === 'clear') {
                    this.clear();
                }
            });
        });
    }
    
    _updateModeButtons() {
        this.infoPanel?.querySelectorAll('.measure-mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === this.mode);
        });
    }
    
    _showInfoPanel() {
        if (this.infoPanel) {
            this.infoPanel.classList.add('visible');
        }
    }
    
    _hideInfoPanel() {
        if (this.infoPanel) {
            this.infoPanel.classList.remove('visible');
        }
    }
    
    _onClick(e) {
        if (!this.enabled) return;
        
        // Игнорируем клик по панели
        if (e.originalEvent.target.closest('#map-measure-panel')) return;
        
        const point = [e.lngLat.lng, e.lngLat.lat];
        this.currentPoints.push(point);
        
        this._updateLayers();
        this._updateInfoPanel();
    }
    
    _onMouseMove(e) {
        if (!this.enabled || this.currentPoints.length === 0) return;
        
        const lastPoint = this.currentPoints[this.currentPoints.length - 1];
        const currentPoint = [e.lngLat.lng, e.lngLat.lat];
        
        let coords;
        if (this.mode === 'polygon' && this.currentPoints.length >= 2) {
            // Показываем замыкание полигона
            coords = [...this.currentPoints, currentPoint, this.currentPoints[0]];
        } else {
            coords = [lastPoint, currentPoint];
        }
        
        this.map.getSource(this.tempSourceId).setData({
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: coords
            }
        });
    }
    
    _onDblClick(e) {
        if (!this.enabled) return;
        e.preventDefault();
        
        // Убираем последнюю точку (добавленную первым кликом dblclick)
        if (this.currentPoints.length > 0) {
            this.currentPoints.pop();
        }
        
        this._finishCurrentMeasurement();
    }
    
    _onContextMenu(e) {
        if (!this.enabled) return;
        e.preventDefault();
        
        // ПКМ — отмена последней точки
        if (this.currentPoints.length > 0) {
            this.currentPoints.pop();
            this._updateLayers();
            this._updateInfoPanel();
        }
    }
    
    _finishCurrentMeasurement() {
        if (this.currentPoints.length < 2) {
            this.currentPoints = [];
            this._updateLayers();
            return;
        }
        
        if (this.mode === 'polygon' && this.currentPoints.length < 3) {
            this.currentPoints = [];
            this._updateLayers();
            return;
        }
        
        // Сохраняем измерение
        const measurement = {
            id: ++this.measurementIdCounter,
            type: this.mode,
            points: [...this.currentPoints],
            distance: this._calculateTotalDistance(this.currentPoints),
            area: this.mode === 'polygon' ? this._calculateArea(this.currentPoints) : null
        };
        
        this.measurements.push(measurement);
        this._createMeasurementLabel(measurement);
        
        this.currentPoints = [];
        this._updateLayers();
        this._updateInfoPanel();
        this._removeTempLine();
        
        console.log(`[MapMeasureTool] Сохранено измерение #${measurement.id}`);
    }
    
    _removeTempLine() {
        if (this.map.getSource(this.tempSourceId)) {
            this.map.getSource(this.tempSourceId).setData({
                type: 'FeatureCollection',
                features: []
            });
        }
    }
    
    _getGeoJSON() {
        const features = [];
        
        // Сохранённые измерения
        this.measurements.forEach(m => {
            if (m.type === 'line') {
                features.push({
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: m.points },
                    properties: { id: m.id, type: 'line' }
                });
            } else if (m.type === 'polygon') {
                features.push({
                    type: 'Feature',
                    geometry: { type: 'Polygon', coordinates: [[...m.points, m.points[0]]] },
                    properties: { id: m.id, type: 'polygon' }
                });
                // Контур полигона
                features.push({
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: [...m.points, m.points[0]] },
                    properties: { id: m.id, type: 'polygon-outline' }
                });
            }
            
            // Точки
            m.points.forEach((p, i) => {
                features.push({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: p },
                    properties: { id: m.id, index: i }
                });
            });
        });
        
        // Текущее измерение
        if (this.currentPoints.length > 0) {
            // Точки
            this.currentPoints.forEach((p, i) => {
                features.push({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: p },
                    properties: { current: true, index: i }
                });
            });
            
            // Линия/полигон
            if (this.currentPoints.length >= 2) {
                if (this.mode === 'polygon') {
                    features.push({
                        type: 'Feature',
                        geometry: { type: 'Polygon', coordinates: [[...this.currentPoints, this.currentPoints[0]]] },
                        properties: { current: true, type: 'polygon' }
                    });
                }
                features.push({
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: this.currentPoints },
                    properties: { current: true, type: 'line' }
                });
            }
        }
        
        return { type: 'FeatureCollection', features };
    }
    
    _updateLayers() {
        const source = this.map.getSource(this.sourceId);
        if (source) {
            source.setData(this._getGeoJSON());
        }
        
        // Обновляем кнопку "Завершить"
        const finishBtn = this.infoPanel?.querySelector('[data-action="finish"]');
        if (finishBtn) {
            const minPoints = this.mode === 'polygon' ? 3 : 2;
            finishBtn.disabled = this.currentPoints.length < minPoints;
        }
    }
    
    _updateInfoPanel() {
        if (!this.infoPanel) return;
        
        const stats = this.infoPanel.querySelector('.measure-stats');
        const list = this.infoPanel.querySelector('.measure-list');
        
        // Текущее измерение
        let html = '';
        if (this.currentPoints.length > 0) {
            const dist = this._calculateTotalDistance(this.currentPoints);
            html += `<div class="measure-current">`;
            html += `<strong>Расстояние:</strong> ${this._formatDistance(dist)}`;
            
            if (this.mode === 'polygon' && this.currentPoints.length >= 3) {
                const area = this._calculateArea(this.currentPoints);
                html += `<br><strong>Площадь:</strong> ${this._formatArea(area)}`;
            }
            html += `</div>`;
        }
        stats.innerHTML = html;
        
        // Список сохранённых
        let listHtml = '';
        if (this.measurements.length > 0) {
            listHtml = '<div class="measure-list-title">Сохранённые:</div>';
            this.measurements.forEach(m => {
                listHtml += `<div class="measure-list-item" data-id="${m.id}">`;
                if (m.type === 'line') {
                    listHtml += `📏 ${this._formatDistance(m.distance)}`;
                } else {
                    listHtml += `⬡ ${this._formatArea(m.area)} (${this._formatDistance(m.distance)})`;
                }
                listHtml += `<button class="measure-delete-btn" data-id="${m.id}">✕</button>`;
                listHtml += `</div>`;
            });
        }
        list.innerHTML = listHtml;
        
        // Обработчики удаления
        list.querySelectorAll('.measure-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._deleteMeasurement(parseInt(btn.dataset.id));
            });
        });
    }
    
    _deleteMeasurement(id) {
        this.measurements = this.measurements.filter(m => m.id !== id);
        
        // Удаляем метку
        const label = this.labelsContainer?.querySelector(`[data-measure-id="${id}"]`);
        if (label) label.remove();
        
        this._updateLayers();
        this._updateInfoPanel();
    }
    
    _createMeasurementLabel(measurement) {
        const label = document.createElement('div');
        label.className = 'map-measure-label';
        label.dataset.measureId = measurement.id;
        
        // Центр измерения
        let center;
        if (measurement.type === 'polygon') {
            center = this._getPolygonCenter(measurement.points);
            label.innerHTML = `<strong>${this._formatArea(measurement.area)}</strong>`;
        } else {
            center = this._getLineCenter(measurement.points);
            label.innerHTML = `<strong>${this._formatDistance(measurement.distance)}</strong>`;
        }
        
        label._lngLat = center;
        this.labelsContainer.appendChild(label);
        this.labels.push(label);
        
        this._updateLabelPosition(label);
        
        // Обновление при движении карты
        if (!this._moveHandler) {
            this._moveHandler = () => this._updateAllLabelPositions();
            this.map.on('move', this._moveHandler);
        }
    }
    
    _clearLabels() {
        this.labels.forEach(label => label.remove());
        this.labels = [];
    }
    
    _updateLabelPosition(label) {
        if (!label._lngLat) return;
        const pos = this.map.project(label._lngLat);
        label.style.left = pos.x + 'px';
        label.style.top = pos.y + 'px';
    }
    
    _updateAllLabelPositions() {
        this.labels.forEach(label => this._updateLabelPosition(label));
    }
    
    _getPolygonCenter(points) {
        let lat = 0, lng = 0;
        points.forEach(p => {
            lng += p[0];
            lat += p[1];
        });
        return [lng / points.length, lat / points.length];
    }
    
    _getLineCenter(points) {
        const mid = Math.floor(points.length / 2);
        if (points.length % 2 === 0) {
            return [
                (points[mid - 1][0] + points[mid][0]) / 2,
                (points[mid - 1][1] + points[mid][1]) / 2
            ];
        }
        return points[mid];
    }
    
    _calculateTotalDistance(points) {
        let total = 0;
        for (let i = 1; i < points.length; i++) {
            total += this._haversineDistance(points[i - 1], points[i]);
        }
        return total;
    }
    
    _haversineDistance(p1, p2) {
        const R = 6371000;
        const lat1 = p1[1] * Math.PI / 180;
        const lat2 = p2[1] * Math.PI / 180;
        const dLat = (p2[1] - p1[1]) * Math.PI / 180;
        const dLng = (p2[0] - p1[0]) * Math.PI / 180;
        
        const a = Math.sin(dLat / 2) ** 2 +
                  Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    
    _calculateArea(points) {
        // Формула Shoelace для площади на сфере (приближение)
        if (points.length < 3) return 0;
        
        const R = 6371000;
        let area = 0;
        
        // Проецируем в метры относительно центра
        const center = this._getPolygonCenter(points);
        const cosLat = Math.cos(center[1] * Math.PI / 180);
        
        const projected = points.map(p => ({
            x: (p[0] - center[0]) * Math.PI / 180 * R * cosLat,
            y: (p[1] - center[1]) * Math.PI / 180 * R
        }));
        
        // Shoelace
        for (let i = 0; i < projected.length; i++) {
            const j = (i + 1) % projected.length;
            area += projected[i].x * projected[j].y;
            area -= projected[j].x * projected[i].y;
        }
        
        return Math.abs(area) / 2;
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
        this.disable();
        this.clear();
        
        ['fillLayerId', 'lineLayerId', 'pointLayerId', 'tempLineLayerId'].forEach(id => {
            if (this.map.getLayer(this[id])) this.map.removeLayer(this[id]);
        });
        ['sourceId', 'tempSourceId'].forEach(id => {
            if (this.map.getSource(this[id])) this.map.removeSource(this[id]);
        });
        
        if (this._moveHandler) this.map.off('move', this._moveHandler);
        if (this.labelsContainer) this.labelsContainer.remove();
        if (this.infoPanel) this.infoPanel.remove();
    }
}

export { MapMeasureTool };
window.MapMeasureTool = MapMeasureTool;