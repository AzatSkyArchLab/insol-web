/**
 * ============================================
 * ProjectImporter.js
 * Импорт проекта из GeoJSON
 * ============================================
 */

class ProjectImporter {
    constructor(sceneManager, coords, buildingMesh, options = {}) {
        this.sceneManager = sceneManager;
        this.coords = coords;
        this.buildingMesh = buildingMesh;
        
        this.onImportComplete = options.onImportComplete || (() => {});
        this.onError = options.onError || ((err) => console.error(err));
        
        console.log('[ProjectImporter] Создан');
    }
    
    /**
     * Импортировать GeoJSON из файла
     * @param {File} file - Файл GeoJSON
     */
    importFromFile(file) {
        const reader = new FileReader();
        
        reader.onload = (e) => {
            try {
                const geojson = JSON.parse(e.target.result);
                this.importGeoJSON(geojson);
            } catch (err) {
                this.onError(`Ошибка парсинга GeoJSON: ${err.message}`);
            }
        };
        
        reader.onerror = () => {
            this.onError('Ошибка чтения файла');
        };
        
        reader.readAsText(file);
    }
    
    /**
     * Импортировать GeoJSON объект
     * @param {Object} geojson - GeoJSON FeatureCollection
     * @returns {Object} Результат импорта
     */
    importGeoJSON(geojson) {
        if (!geojson || geojson.type !== 'FeatureCollection') {
            this.onError('Неверный формат GeoJSON: ожидается FeatureCollection');
            return null;
        }
        
        const features = geojson.features || [];
        const results = {
            imported: 0,
            skipped: 0,
            errors: []
        };
        
        // Метаданные проекта
        const projectProps = geojson.properties || {};
        
        console.log(`[ProjectImporter] Импорт ${features.length} объектов...`);
        
        features.forEach((feature, index) => {
            try {
                if (this._importFeature(feature)) {
                    results.imported++;
                } else {
                    results.skipped++;
                }
            } catch (err) {
                results.errors.push(`Feature ${index}: ${err.message}`);
                results.skipped++;
            }
        });
        
        console.log(`[ProjectImporter] Импортировано: ${results.imported}, пропущено: ${results.skipped}`);
        
        this.onImportComplete(results, projectProps);
        
        return results;
    }
    
    /**
     * Импортировать один Feature
     */
    _importFeature(feature) {
        if (!feature || feature.type !== 'Feature') {
            return false;
        }
        
        const geometry = feature.geometry;
        const properties = feature.properties || {};
        
        if (!geometry || geometry.type !== 'Polygon') {
            console.warn('[ProjectImporter] Пропуск: не полигон', feature);
            return false;
        }
        
        const coordinates = geometry.coordinates;
        if (!coordinates || !coordinates[0] || coordinates[0].length < 4) {
            console.warn('[ProjectImporter] Пропуск: недостаточно координат');
            return false;
        }
        
        // Внешнее кольцо полигона (без последней точки - она дублирует первую)
        const ring = coordinates[0].slice(0, -1);
        
        // Конвертируем WGS84 в локальные координаты
        const localPoints = ring.map(coord => {
            const lng = coord[0];
            const lat = coord[1];
            return this.coords.wgs84ToMeters(lat, lng);
        });
        
        // Высота
        const height = properties.height || 9;
        
        // Создаём здание
        const mesh = this.buildingMesh.createFromPoints(localPoints, height);
        
        if (!mesh) {
            console.warn('[ProjectImporter] Не удалось создать mesh');
            return false;
        }
        
        // Устанавливаем свойства
        mesh.userData.id = properties.id || `imported_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        mesh.userData.properties = {
            height: height,
            isResidential: properties.isResidential || false,
            source: properties.source || 'imported',
            floors: properties.floors || null,
            name: properties.name || null
        };
        
        // Копируем OSM свойства
        const osmKeys = ['building', 'building:levels', 'roof:shape', 'addr:street', 'addr:housenumber'];
        osmKeys.forEach(key => {
            if (properties[key] !== undefined) {
                mesh.userData.properties[key] = properties[key];
            }
        });
        
        // Устанавливаем цвет
        if (mesh.userData.properties.isResidential) {
            mesh.material.color.setHex(0x6b88a8);  // Синий для жилых
        } else {
            mesh.material.color.setHex(0x999999);  // Серый
        }
        
        // Добавляем в сцену
        const buildingsGroup = this.sceneManager.getBuildingsGroup();
        buildingsGroup.add(mesh);
        
        return true;
    }
    
    /**
     * Очистить все здания перед импортом
     */
    clearAllBuildings() {
        const buildingsGroup = this.sceneManager.getBuildingsGroup();
        
        while (buildingsGroup.children.length > 0) {
            const mesh = buildingsGroup.children[0];
            buildingsGroup.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
        }
        
        console.log('[ProjectImporter] Все здания удалены');
    }
}

export { ProjectImporter };
window.ProjectImporter = ProjectImporter;