/**
 * ============================================
 * BuildingLoader.js
 * Загрузка зданий из OSM (через osmtogeojson)
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
        this.bufferMeters = 100;
        
        console.log('[BuildingLoader] Создан');
    }
    
    async loadBuildings(south, west, north, east, options = {}) {
        const useBuffer = options.buffer !== false;
        
        let querySouth = south;
        let queryWest = west;
        let queryNorth = north;
        let queryEast = east;
        
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
        
        // Запрос возвращает JSON для osmtogeojson
        const query = `
            [out:json][timeout:60];
            (
                way["building"](${querySouth},${queryWest},${queryNorth},${queryEast});
                relation["building"](${querySouth},${queryWest},${queryNorth},${queryEast});
            );
            out body;
            >;
            out skel qt;
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
                
                const osmData = await response.json();
                
                // Конвертируем через osmtogeojson
                const geojson = osmtogeojson(osmData);
                
                // Парсим GeoJSON в наш формат
                const buildings = this._parseGeoJSON(geojson);
                
                // Фильтруем
                const filtered = this._filterByIntersection(buildings, south, west, north, east);
                
                console.log(`[BuildingLoader] GeoJSON features: ${geojson.features.length}, зданий: ${filtered.length}`);
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
     * Парсинг GeoJSON от osmtogeojson
     */
    _parseGeoJSON(geojson) {
        const buildings = [];
        
        for (const feature of geojson.features) {
            const geom = feature.geometry;
            const props = feature.properties;
            
            // Пропускаем не-здания и точки
            if (!props.building) continue;
            if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') continue;
            
            const osmId = feature.id || props.id || `unknown-${buildings.length}`;
            const buildingProps = this._extractProperties(props);
            
            if (geom.type === 'Polygon') {
                // Polygon: первое кольцо — outer, остальные — holes
                const outer = geom.coordinates[0];
                const holes = geom.coordinates.slice(1);
                
                if (outer && outer.length >= 4) {
                    buildings.push({
                        id: osmId,
                        type: 'polygon',
                        coordinates: outer,
                        holes: holes.filter(h => h && h.length >= 4),
                        properties: buildingProps
                    });
                }
            } else if (geom.type === 'MultiPolygon') {
                // MultiPolygon: несколько полигонов, каждый со своими дырками
                for (let i = 0; i < geom.coordinates.length; i++) {
                    const polygon = geom.coordinates[i];
                    const outer = polygon[0];
                    const holes = polygon.slice(1);
                    
                    if (outer && outer.length >= 4) {
                        buildings.push({
                            id: `${osmId}-${i}`,
                            type: 'multipolygon',
                            coordinates: outer,
                            holes: holes.filter(h => h && h.length >= 4),
                            properties: buildingProps
                        });
                    }
                }
            }
        }
        
        return buildings;
    }
    
    _filterByIntersection(buildings, south, west, north, east) {
        return buildings.filter(building => {
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
            
            if (hasPointInside) return true;
            
            return !(maxLat < south || minLat > north || maxLon < west || minLon > east);
        });
    }
    
    _extractProperties(props) {
        let height = null;
        let levels = null;
        
        if (props['building:levels']) {
            levels = parseInt(props['building:levels']);
        }
        
        if (props.height) {
            const heightStr = String(props.height).replace(/[^\d.]/g, '');
            height = parseFloat(heightStr);
        }
        
        if (!height || isNaN(height) || height < 2) {
            if (levels && levels > 0) {
                height = levels * 3;
            } else {
                height = 9;
            }
        }
        
        const buildingTag = props.building || 'yes';
        const residentialTypes = [
            'apartments', 'residential', 'house', 'detached', 
            'semidetached_house', 'terrace', 'dormitory'
        ];
        
        return {
            height: height,
            levels: levels,
            name: props.name || null,
            buildingType: buildingTag,
            isResidential: residentialTypes.includes(buildingTag),
            address: props['addr:street'] ? 
                `${props['addr:street']} ${props['addr:housenumber'] || ''}`.trim() : null,
            heightSource: props.height ? 'osm' : (levels ? 'levels' : 'default')
        };
    }
}

export { BuildingLoader };
window.BuildingLoader = BuildingLoader;
window.osmtogeojson = osmtogeojson;