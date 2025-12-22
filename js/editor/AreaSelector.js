/**
 * ============================================
 * AreaSelector.js
 * Выбор и редактирование области на карте
 * ============================================
 */

class AreaSelector {
    constructor(mapEngine, options = {}) {
        this.mapEngine = mapEngine;
        this.map = mapEngine.getMap();
        
        this.maxSizeMeters = options.maxSize || 500;
        
        // Состояние
        this.enabled = false;
        this.isDrawing = false;
        this.startPoint = null;
        this.endPoint = null;
        this.bounds = null;
        
        // DOM элементы
        this.rectElement = null;
        
        // Callback
        this.onSelect = options.onSelect || (() => {});
        this.onChange = options.onChange || (() => {});
        
        this._init();
        console.log('[AreaSelector] Создан');
    }
    
    _init() {
        const container = this.map.getContainer();
        
        // Прямоугольник выбора
        this.rectElement = document.createElement('div');
        this.rectElement.className = 'selection-rect hidden';
        container.appendChild(this.rectElement);
        
        // События
        container.addEventListener('mousedown', (e) => this._onMouseDown(e));
        container.addEventListener('mousemove', (e) => this._onMouseMove(e));
        container.addEventListener('mouseup', (e) => this._onMouseUp(e));
        
        // Обновляем прямоугольник при движении карты
        this.map.on('move', () => this._updateRectFromBounds());
    }
    
    setEnabled(enabled) {
        this.enabled = enabled;
        
        if (enabled) {
            this.map.getContainer().style.cursor = 'crosshair';
            this.map.dragPan.disable();
            this.map.scrollZoom.disable();
        } else {
            this.map.getContainer().style.cursor = '';
            this.map.dragPan.enable();
            this.map.scrollZoom.enable();
        }
        
        console.log('[AreaSelector] Режим:', enabled ? 'ВКЛ' : 'ВЫКЛ');
    }
    
    _onMouseDown(e) {
        if (!this.enabled) return;
        if (e.button !== 0) return;
        if (e.target.closest('#info-panel')) return;
        
        this.isDrawing = true;
        this.startPoint = { x: e.offsetX, y: e.offsetY };
        
        this.rectElement.classList.remove('hidden');
        this._updateRect(this.startPoint, this.startPoint);
    }
    
    _onMouseMove(e) {
        if (!this.isDrawing) return;
        
        this.endPoint = { x: e.offsetX, y: e.offsetY };
        this._updateRect(this.startPoint, this.endPoint);
        this._updateInfo();
    }
    
    _onMouseUp(e) {
        if (!this.isDrawing) return;
        
        this.isDrawing = false;
        
        if (this.startPoint && this.endPoint) {
            this._calculateBounds();
            this.onSelect(this.bounds);
            this.onChange(this.bounds);
        }
    }
    
    _updateRect(start, end) {
        const left = Math.min(start.x, end.x);
        const top = Math.min(start.y, end.y);
        const width = Math.abs(end.x - start.x);
        const height = Math.abs(end.y - start.y);
        
        this.rectElement.style.left = left + 'px';
        this.rectElement.style.top = top + 'px';
        this.rectElement.style.width = width + 'px';
        this.rectElement.style.height = height + 'px';
    }
    
    /**
     * Обновить прямоугольник из сохранённых bounds (при движении карты)
     */
    _updateRectFromBounds() {
        if (!this.bounds || this.isDrawing) return;
        
        // Конвертируем bounds обратно в пиксели
        const sw = this.map.project([this.bounds.west, this.bounds.south]);
        const ne = this.map.project([this.bounds.east, this.bounds.north]);
        
        this.startPoint = { x: sw.x, y: ne.y };
        this.endPoint = { x: ne.x, y: sw.y };
        
        this._updateRect(this.startPoint, this.endPoint);
    }
    
    _calculateBounds() {
        const sw = this.map.unproject([
            Math.min(this.startPoint.x, this.endPoint.x),
            Math.max(this.startPoint.y, this.endPoint.y)
        ]);
        const ne = this.map.unproject([
            Math.max(this.startPoint.x, this.endPoint.x),
            Math.min(this.startPoint.y, this.endPoint.y)
        ]);
        
        this.bounds = {
            south: sw.lat,
            west: sw.lng,
            north: ne.lat,
            east: ne.lng
        };
    }
    
    _updateInfo() {
        if (!this.startPoint || !this.endPoint) return;
        
        this._calculateBounds();
        
        const centerLat = (this.bounds.north + this.bounds.south) / 2;
        const latDiff = Math.abs(this.bounds.north - this.bounds.south);
        const lonDiff = Math.abs(this.bounds.east - this.bounds.west);
        
        const heightM = latDiff * 111320;
        const widthM = lonDiff * 111320 * Math.cos(centerLat * Math.PI / 180);
        
        const infoEl = document.getElementById('selection-info');
        const loadBtn = document.getElementById('load-btn');
        
        const isValid = widthM <= this.maxSizeMeters && 
                        heightM <= this.maxSizeMeters && 
                        widthM > 10 && 
                        heightM > 10;
        
        if (infoEl) {
            infoEl.innerHTML = `
                Размер: ${widthM.toFixed(0)} × ${heightM.toFixed(0)} м<br>
                ${isValid ? '✓ OK' : '✗ Макс. 500×500 м'}
            `;
        }
        
        if (loadBtn) {
            loadBtn.disabled = !isValid;
        }
    }
    
    /**
     * Получить bounds
     */
    getBounds() {
        return this.bounds;
    }
    
    /**
     * Установить bounds программно
     */
    setBounds(bounds) {
        this.bounds = bounds;
        this._updateRectFromBounds();
        this._updateInfo();
        this.rectElement.classList.remove('hidden');
    }
    
    /**
     * Проверить валидность текущей области
     */
    isValid() {
        if (!this.bounds) return false;
        
        const centerLat = (this.bounds.north + this.bounds.south) / 2;
        const latDiff = Math.abs(this.bounds.north - this.bounds.south);
        const lonDiff = Math.abs(this.bounds.east - this.bounds.west);
        
        const heightM = latDiff * 111320;
        const widthM = lonDiff * 111320 * Math.cos(centerLat * Math.PI / 180);
        
        return widthM <= this.maxSizeMeters && 
               heightM <= this.maxSizeMeters && 
               widthM > 10 && 
               heightM > 10;
    }
    
    /**
     * Сброс (полный)
     */
    reset() {
        this.startPoint = null;
        this.endPoint = null;
        this.bounds = null;
        this.rectElement.classList.add('hidden');
        this.setEnabled(false);
        
        const infoEl = document.getElementById('selection-info');
        if (infoEl) infoEl.innerHTML = '';
        
        const loadBtn = document.getElementById('load-btn');
        if (loadBtn) loadBtn.disabled = true;
    }
    
    /**
     * Выход из режима рисования (без сброса области)
     */
    disableDrawing() {
        this.setEnabled(false);
    }
}

export { AreaSelector };
window.AreaSelector = AreaSelector;