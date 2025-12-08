/**
 * ============================================
 * MapEngine.js
 * Управление картой MapLibre GL JS
 * ============================================
 */

class MapEngine {
    /**
     * @param {string} containerId - ID контейнера для карты
     * @param {Object} options - Настройки
     */
    constructor(containerId = 'map', options = {}) {
        this.containerId = containerId;
        this.map = null;
        
        // Настройки по умолчанию (Москва)
        this.options = {
            center: [37.6173, 55.7558], // [lon, lat] — формат MapLibre
            zoom: 16,
            pitch: 45,                   // Наклон камеры
            bearing: 0,                  // Поворот карты
            ...options
        };
        
        console.log('[MapEngine] Создан');
    }
    
    /**
     * Инициализация карты
     */
    init() {
        this.map = new maplibregl.Map({
            container: this.containerId,
            style: this._getStyle(),
            center: this.options.center,
            zoom: this.options.zoom,
            pitch: this.options.pitch,
            bearing: this.options.bearing,
            antialias: true
        });
        
        // Добавляем контролы
        this.map.addControl(new maplibregl.NavigationControl(), 'top-right');
        this.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
        
        // События
        this.map.on('load', () => {
            console.log('[MapEngine] Карта загружена');
        });
        
        this.map.on('move', () => {
            this._onCameraChange();
        });
        
        console.log('[MapEngine] Инициализация...');
        return this;
    }
    
    /**
     * Стиль карты (OSM + Esri спутник опционально)
     */
    _getStyle() {
        return {
            version: 8,
            sources: {
                'osm': {
                    type: 'raster',
                    tiles: [
                        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
                        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
                        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
                    ],
                    tileSize: 256,
                    attribution: '© OpenStreetMap contributors'
                }
            },
            layers: [
                {
                    id: 'osm-layer',
                    type: 'raster',
                    source: 'osm',
                    minzoom: 0,
                    maxzoom: 19
                }
            ]
        };
    }
    
    /**
     * Вызывается при движении камеры
     */
    _onCameraChange() {
        const center = this.map.getCenter();
        
        // Обновляем отображение координат
        const latEl = document.getElementById('lat');
        const lonEl = document.getElementById('lon');
        
        if (latEl) latEl.textContent = center.lat.toFixed(6);
        if (lonEl) lonEl.textContent = center.lng.toFixed(6);
    }
    
    /**
     * Получить текущий центр
     * @returns {{lat: number, lon: number}}
     */
    getCenter() {
        const center = this.map.getCenter();
        return { lat: center.lat, lon: center.lng };
    }
    
    /**
     * Получить границы видимой области
     * @returns {{sw: {lat, lon}, ne: {lat, lon}}}
     */
    getBounds() {
        const bounds = this.map.getBounds();
        return {
            sw: { lat: bounds.getSouth(), lon: bounds.getWest() },
            ne: { lat: bounds.getNorth(), lon: bounds.getEast() }
        };
    }
    
    /**
     * Переместить камеру
     */
    flyTo(lat, lon, zoom = null) {
        this.map.flyTo({
            center: [lon, lat],
            zoom: zoom || this.map.getZoom(),
            essential: true
        });
    }
    
    /**
     * Получить объект карты для внешнего использования
     */
    getMap() {
        return this.map;
    }
}

export { MapEngine };
window.MapEngine = MapEngine;