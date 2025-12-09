/**
 * ============================================
 * BuildingLoader.js
 * Загрузка зданий из OpenStreetMap
 * ============================================
 */

class BuildingLoader {
    constructor() {
        this.overpassServers = [
            'https://overpass-api.de/api/interpreter',
            'https://overpass.kumi.systems/api/interpreter',
            'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
        ];
        this.currentServer = 0;
        
        // Буфер расширения bbox (в метрах)
        this.bufferMeters = 100;
        
        console.log('[BuildingLoader] Создан');
    }
    
    /**
     * Загрузить здания с буфером
     * @param {number} south 
     * @param {number} west 
     * @param {number} north 
     * @param {number} east 
     * @param {Object} options - { buffer: true/false }
     */
    async loadBuildings(south, west, north, east, options = {}) {
        const useBuffer = options.buffer !== false; // По умолчанию true
        
        let querySouth = south;
        let queryWest = west;
        let queryNorth = north;
        let queryEast = east;
        
        // Расширяем bbox для захвата пограничных зданий
        if (useBuffer) {
            const centerLat = (south + north) / 2;
            const latBuffer = this.bufferMeters / 111320;
            const lonBuffer = this.bufferMeters / (111320 * Math.cos(centerLat * Math.PI / 180));
            
            querySouth = south - latBuffer;
            queryNorth = north + latBuffer;
            queryWest = west - lonBuffer;
            queryEast = east + lonBuffer;
            
            console.log(`[BuildingLoader] Буфер: +${this.bufferMeters}м`);
        }
        
        console.log(`[BuildingLoader] Загрузка: ${querySouth.toFixed(5)}, ${queryWest.toFixed(5)} → ${queryNorth.toFixed(5)}, ${queryEast.toFixed(5)}`);
        
        // Запрос с полной геометрией (out geom)
        const query = `
            [out:json][timeout:60];
            way["building"](${querySouth},${queryWest},${queryNorth},${queryEast});
            out body geom;
        `;
        
        for (let attempt = 0; attempt < 3; attempt++) {
            const server = this.overpassServers[this.currentServer];
            
            try {
                console.log(`[BuildingLoader] Попытка ${attempt + 1}, сервер: ${server}`);
                
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 30000);
                
                const response = await fetch(server, {
                    method: 'POST',
                    body: `data=${encodeURIComponent(query)}`,
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    signal: controller.signal
                });
                
                clearTimeout(timeout);
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                const data = await response.json();
                const buildings = this._parseResponseWithGeom(data);
                
                // Фильтруем — оставляем только те, что пересекают исходный bbox
                const filtered = this._filterByIntersection(buildings, south, west, north, east);
                
                console.log(`[BuildingLoader] Загружено: ${buildings.length}, после фильтра: ${filtered.length}`);
                return filtered;
                
            } catch (error) {
                console.warn(`[BuildingLoader] Ошибка: ${error.message}`);
                this.currentServer = (this.currentServer + 1) % this.overpassServers.length;
            }
        }
        
        console.error('[BuildingLoader] Все попытки исчерпаны');
        return [];
    }
    
    /**
     * Парсинг ответа с геометрией (out geom)
     */
    _parseResponseWithGeom(data) {
        const buildings = [];
        
        for (const element of data.elements) {
            if (element.type === 'way' && element.geometry) {
                const coordinates = element.geometry.map(node => [node.lon, node.lat]);
                
                if (coordinates.length >= 4) {
                    buildings.push({
                        id: element.id,
                        type: 'way',
                        coordinates: coordinates,
                        properties: this._extractProperties(element.tags)
                    });
                }
            }
        }
        
        return buildings;
    }
    
    /**
     * Фильтр — оставляем здания, пересекающие область
     */
    _filterByIntersection(buildings, south, west, north, east) {
        return buildings.filter(building => {
            // Проверяем — хотя бы одна вершина внутри bbox
            // ИЛИ bbox здания пересекает наш bbox
            
            let minLat = Infinity, maxLat = -Infinity;
            let minLon = Infinity, maxLon = -Infinity;
            let hasPointInside = false;
            
            for (const coord of building.coordinates) {
                const lon = coord[0];
                const lat = coord[1];
                
                minLat = Math.min(minLat, lat);
                maxLat = Math.max(maxLat, lat);
                minLon = Math.min(minLon, lon);
                maxLon = Math.max(maxLon, lon);
                
                if (lat >= south && lat <= north && lon >= west && lon <= east) {
                    hasPointInside = true;
                }
            }
            
            // Хотя бы одна точка внутри — берём здание
            if (hasPointInside) {
                return true;
            }
            
            // Или bbox'ы пересекаются (здание может пересекать область без точек внутри)
            const bboxIntersects = !(maxLat < south || minLat > north || maxLon < west || minLon > east);
            
            return bboxIntersects;
        });
    }
    
    _extractProperties(tags = {}) {
        let height = null;
        
        if (tags.height) {
            height = parseFloat(tags.height);
        } else if (tags['building:levels']) {
            height = parseFloat(tags['building:levels']) * 3;
        }
        
        if (!height || isNaN(height) || height < 2) {
            height = 9;
        }
        
        return {
            height: height,
            levels: tags['building:levels'] ? parseInt(tags['building:levels']) : null,
            name: tags.name || null,
            buildingType: tags.building || 'yes'
        };
    }
}

export { BuildingLoader };
window.BuildingLoader = BuildingLoader;