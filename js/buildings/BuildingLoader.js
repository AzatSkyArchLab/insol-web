/**
 * ============================================
 * BuildingLoader.js
 * Загрузка зданий из OpenStreetMap (Overpass API)
 * ============================================
 */

class BuildingLoader {
    constructor() {
        // Overpass API endpoint
        this.overpassUrl = 'https://overpass-api.de/api/interpreter';
        
        console.log('[BuildingLoader] Создан');
    }
    
    /**
     * Загрузить здания в указанном bbox
     * @param {number} south - Южная граница (lat)
     * @param {number} west - Западная граница (lon)
     * @param {number} north - Северная граница (lat)
     * @param {number} east - Восточная граница (lon)
     * @returns {Promise<Array>} - Массив зданий в формате GeoJSON-like
     */
    async loadBuildings(south, west, north, east) {
        console.log(`[BuildingLoader] Загрузка зданий: ${south.toFixed(4)}, ${west.toFixed(4)} → ${north.toFixed(4)}, ${east.toFixed(4)}`);
        
        // Overpass QL запрос
        const query = `
            [out:json][timeout:30];
            (
                way["building"](${south},${west},${north},${east});
                relation["building"](${south},${west},${north},${east});
            );
            out body;
            >;
            out skel qt;
        `;
        
        try {
            const response = await fetch(this.overpassUrl, {
                method: 'POST',
                body: `data=${encodeURIComponent(query)}`,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            const buildings = this._parseResponse(data);
            
            console.log(`[BuildingLoader] Загружено зданий: ${buildings.length}`);
            return buildings;
            
        } catch (error) {
            console.error('[BuildingLoader] Ошибка загрузки:', error);
            return [];
        }
    }
    
    /**
     * Парсинг ответа Overpass API
     */
    _parseResponse(data) {
        const nodes = {};
        const buildings = [];
        
        // Сначала собираем все узлы (точки)
        for (const element of data.elements) {
            if (element.type === 'node') {
                nodes[element.id] = {
                    lat: element.lat,
                    lon: element.lon
                };
            }
        }
        
        // Затем собираем здания (ways)
        for (const element of data.elements) {
            if (element.type === 'way' && element.nodes) {
                const coordinates = [];
                
                for (const nodeId of element.nodes) {
                    const node = nodes[nodeId];
                    if (node) {
                        coordinates.push([node.lon, node.lat]);
                    }
                }
                
                if (coordinates.length >= 3) {
                    const building = {
                        id: element.id,
                        type: 'way',
                        coordinates: coordinates,
                        properties: this._extractProperties(element.tags)
                    };
                    buildings.push(building);
                }
            }
        }
        
        return buildings;
    }
    
    /**
     * Извлечение свойств здания из тегов OSM
     */
    _extractProperties(tags = {}) {
        // Высота здания
        let height = null;
        
        if (tags.height) {
            // Парсим "25" или "25m" или "25 m"
            height = parseFloat(tags.height);
        } else if (tags['building:levels']) {
            // 1 этаж ≈ 3 метра
            height = parseFloat(tags['building:levels']) * 3;
        }
        
        // Если высота не указана — дефолт 10м
        if (!height || isNaN(height)) {
            height = 10;
        }
        
        return {
            height: height,
            levels: tags['building:levels'] ? parseInt(tags['building:levels']) : null,
            name: tags.name || null,
            buildingType: tags.building || 'yes'
        };
    }
    
    /**
     * Загрузить здания по центру и радиусу (в метрах)
     * @param {number} centerLat
     * @param {number} centerLon
     * @param {number} radiusMeters - Радиус в метрах (макс 250 = область 500x500)
     */
    async loadBuildingsAround(centerLat, centerLon, radiusMeters = 150) {
        // Ограничение по ТЗ
        radiusMeters = Math.min(radiusMeters, 250);
        
        // Конвертация метров в градусы (приблизительно)
        const latOffset = radiusMeters / 111000;
        const lonOffset = radiusMeters / (111000 * Math.cos(centerLat * Math.PI / 180));
        
        const south = centerLat - latOffset;
        const north = centerLat + latOffset;
        const west = centerLon - lonOffset;
        const east = centerLon + lonOffset;
        
        return this.loadBuildings(south, west, north, east);
    }
}

export { BuildingLoader };
window.BuildingLoader = BuildingLoader;