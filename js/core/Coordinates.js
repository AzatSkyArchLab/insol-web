/**
 * ============================================
 * Coordinates.js
 * Система координат для Insol Web
 * ============================================
 * 
 * Три системы координат:
 * 1. WGS84 (lat, lon) — географические, для карты и хранения
 * 2. Метры (x, y) — локальные, относительно центра области
 * 3. Three.js (x, y, z) — для 3D сцены (Y вверх или Z вверх)
 * 
 * Важно: Three.js по умолчанию Y-up, но мы используем Z-up
 * чтобы соответствовать Rhino и архитектурным стандартам.
 */

class Coordinates {
    /**
     * @param {number} centerLat - Широта центра области (градусы)
     * @param {number} centerLon - Долгота центра области (градусы)
     */
    constructor(centerLat = 55.7558, centerLon = 37.6173) {
        this.centerLat = centerLat;
        this.centerLon = centerLon;
        
        // Метров в одном градусе (зависит от широты)
        // Формула для эллипсоида WGS84
        this.metersPerDegreeLat = 111132.92 - 559.82 * Math.cos(2 * this.toRadians(centerLat));
        this.metersPerDegreeLon = 111412.84 * Math.cos(this.toRadians(centerLat));
        
        console.log(`[Coordinates] Центр: ${centerLat}°, ${centerLon}°`);
        console.log(`[Coordinates] 1° широты = ${this.metersPerDegreeLat.toFixed(2)} м`);
        console.log(`[Coordinates] 1° долготы = ${this.metersPerDegreeLon.toFixed(2)} м`);
    }
    
    /**
     * Градусы → радианы
     */
    toRadians(degrees) {
        return degrees * Math.PI / 180;
    }
    
    /**
     * Радианы → градусы
     */
    toDegrees(radians) {
        return radians * 180 / Math.PI;
    }
    
    /**
     * WGS84 → локальные метры (относительно центра)
     * @param {number} lat - Широта
     * @param {number} lon - Долгота
     * @returns {{x: number, y: number}} - Координаты в метрах
     */
    wgs84ToMeters(lat, lon) {
        const x = (lon - this.centerLon) * this.metersPerDegreeLon;
        const y = (lat - this.centerLat) * this.metersPerDegreeLat;
        return { x, y };
    }
    
    /**
     * Локальные метры → WGS84
     * @param {number} x - X в метрах (восток +)
     * @param {number} y - Y в метрах (север +)
     * @returns {{lat: number, lon: number}}
     */
    metersToWgs84(x, y) {
        const lon = this.centerLon + x / this.metersPerDegreeLon;
        const lat = this.centerLat + y / this.metersPerDegreeLat;
        return { lat, lon };
    }
    
    /**
     * WGS84 → Three.js (Z-up система)
     * @param {number} lat
     * @param {number} lon
     * @param {number} altitude - Высота в метрах (по умолчанию 0)
     * @returns {{x: number, y: number, z: number}}
     */
    wgs84ToThreeJS(lat, lon, altitude = 0) {
        const meters = this.wgs84ToMeters(lat, lon);
        return {
            x: meters.x,
            y: meters.y,  // В Three.js это будет "вглубь" если Z-up
            z: altitude
        };
    }
    
    /**
     * Three.js → WGS84
     * @param {number} x
     * @param {number} y
     * @returns {{lat: number, lon: number}}
     */
    threeJSToWgs84(x, y) {
        return this.metersToWgs84(x, y);
    }
    
    /**
     * Расстояние между двумя точками WGS84 (в метрах)
     * Использует формулу Хаверсина
     */
    distanceWgs84(lat1, lon1, lat2, lon2) {
        const R = 6371000; // Радиус Земли в метрах
        const dLat = this.toRadians(lat2 - lat1);
        const dLon = this.toRadians(lon2 - lon1);
        
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }
    
    /**
     * Обновить центр (при смене области)
     */
    setCenter(lat, lon) {
        this.centerLat = lat;
        this.centerLon = lon;
        this.metersPerDegreeLat = 111132.92 - 559.82 * Math.cos(2 * this.toRadians(lat));
        this.metersPerDegreeLon = 111412.84 * Math.cos(this.toRadians(lat));
        //console.log(`[Coordinates] Новый центр: ${lat}°, ${lon}°`); Пока что нафиг не нужно, ибо спамит жёстко
    }
}

// Экспорт для использования в других модулях
export { Coordinates };

// Также делаем доступным глобально для тестирования в консоли
window.Coordinates = Coordinates;