/**
 * ============================================
 * MapEngine.js
 * Карта MapLibre (только 2D, без вращения)
 * ============================================
 */

class MapEngine {
    constructor(containerId = 'map', options = {}) {
        this.containerId = containerId;
        this.map = null;
        
        this.options = {
            center: [37.6173, 55.7558],
            zoom: 16,
            ...options
        };
        
        console.log('[MapEngine] Создан');
    }
    
    init() {
        this.map = new maplibregl.Map({
            container: this.containerId,
            style: this._getStyle(),
            center: this.options.center,
            zoom: this.options.zoom,
            pitch: 0,
            bearing: 0,
            pitchWithRotate: false,    // Запрет наклона
            dragRotate: false,          // Запрет вращения
            touchZoomRotate: false,     // Запрет вращения тачем
            antialias: true
        });
        
        // Контролы
        this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
        this.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
        
        this.map.on('load', () => {
            console.log('[MapEngine] Карта загружена');
        });
        
        console.log('[MapEngine] Инициализация...');
        return this;
    }
    
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
            layers: [{
                id: 'osm-layer',
                type: 'raster',
                source: 'osm',
                minzoom: 0,
                maxzoom: 19
            }]
        };
    }
    
    getCenter() {
        const center = this.map.getCenter();
        return { lat: center.lat, lon: center.lng };
    }
    
    getBounds() {
        const bounds = this.map.getBounds();
        return {
            sw: { lat: bounds.getSouth(), lon: bounds.getWest() },
            ne: { lat: bounds.getNorth(), lon: bounds.getEast() }
        };
    }
    
    flyTo(lat, lon, zoom = null) {
        this.map.flyTo({
            center: [lon, lat],
            zoom: zoom || this.map.getZoom()
        });
    }
    
    getMap() {
        return this.map;
    }
}

export { MapEngine };
window.MapEngine = MapEngine;